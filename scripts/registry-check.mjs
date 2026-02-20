#!/usr/bin/env node
/**
 * scripts/registry-check.mjs
 * Falha se alguma tabela usada via .from("...") no código não estiver
 * declarada como canonical: true em docs/db-schema.yml.
 * Também valida colunas em .select("..."), .insert({}), .update({}) quando
 * extração é 100% certa (literais simples); casos complexos são ignorados.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ALLOWLIST = new Set([
  "meta_columns",
  "meta_enum_values",
]);

const SCAN_DIRS = ["app/api", "app/admin", "lib", "scripts"];
const FROM_REGEX = /\.from\s*\(\s*["']([^"']+)["']\s*\)/g;

function getCanonicalTables() {
  const ymlPath = path.join(ROOT, "docs", "db-schema.yml");
  const raw = fs.readFileSync(ymlPath, "utf8");
  const doc = yaml.load(raw);
  const tables = doc?.tables || {};
  const canonical = new Set();
  for (const [name, def] of Object.entries(tables)) {
    if (def && def.canonical === true) canonical.add(name);
  }
  return canonical;
}

/** @returns {Map<string, Set<string>>} table -> Set(column names) */
function getTableColumnsMap() {
  const ymlPath = path.join(ROOT, "docs", "db-schema.yml");
  const raw = fs.readFileSync(ymlPath, "utf8");
  const doc = yaml.load(raw);
  const tables = doc?.tables || {};
  const map = new Map();
  for (const [tableName, def] of Object.entries(tables)) {
    if (!def) continue;
    const cols = def.columns;
    if (!cols) continue;
    const set = new Set();
    if (Array.isArray(cols)) {
      for (const c of cols) {
        if (typeof c === "string") set.add(c);
        else if (c && typeof c === "object" && "name" in c) set.add(String(c.name));
      }
    } else if (typeof cols === "object" && cols !== null && !Array.isArray(cols)) {
      for (const key of Object.keys(cols)) set.add(key);
    }
    map.set(tableName, set);
  }
  return map;
}

function* walkDir(dir, base = ROOT) {
  const full = path.join(base, dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return;
  const entries = fs.readdirSync(full, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(dir, e.name);
    if (e.name === "node_modules") continue;
    if (e.isDirectory()) {
      yield* walkDir(rel, base);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/i.test(e.name)) {
      yield path.join(base, rel);
    }
  }
}

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_COLUMN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Token complexo: contém " as ", parênteses, ponto, dois pontos, etc. */
function isComplexSelectToken(token) {
  const t = token.trim();
  if (!t || t === "*") return true;
  if (!VALID_COLUMN_NAME.test(t)) return true;
  if (/\s+as\s+/i.test(t)) return true;
  if (/[().:<>]/.test(t)) return true;
  return false;
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function extractUsedTables() {
  const used = new Set();
  for (const dir of SCAN_DIRS) {
    for (const filePath of walkDir(dir, ROOT)) {
      const content = fs.readFileSync(filePath, "utf8");
      let m;
      FROM_REGEX.lastIndex = 0;
      while ((m = FROM_REGEX.exec(content)) !== null) {
        const name = m[1];
        if (name.length < 2) continue;
        if (VALID_TABLE_NAME.test(name)) used.add(name);
      }
    }
  }
  return used;
}

/**
 * Extrai colunas de .select("col1,col2") — apenas string literal única.
 * @returns {string[]} colunas simples a validar (vazio se não der certeza)
 */
function parseSelectColumns(selectArg) {
  const parts = selectArg.split(",").map((s) => s.trim());
  const out = [];
  for (const p of parts) {
    if (isComplexSelectToken(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Extrai chaves de objeto literal simples { key: val, "key2": val }.
 * Apenas key:, "key":, 'key':. Ignora ...x, [x], etc.
 * @returns {string[]} chaves extraídas (vazio se objeto parecer complexo)
 */
function parseObjectLiteralKeys(objStr) {
  if (objStr.includes("{") || objStr.includes("}")) return [];
  const keyRegex = /(?:^|,)\s*("([^"]*)"|'([^']*)'|([a-zA-Z_][a-zA-Z0-9_]*))\s*:/g;
  const keys = [];
  let match;
  while ((match = keyRegex.exec(objStr)) !== null) {
    const key = match[2] ?? match[3] ?? match[4];
    if (key) keys.push(key);
  }
  return keys;
}

/** Encadeamento .from("T").select("...") — string literal única */
const FROM_SELECT_REGEX = /\.from\s*\(\s*["']([^"']+)["']\s*\)\s*\.select\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Encadeamento .from("T").insert({ ... }) — só objeto single-line sem { } aninhados */
const FROM_INSERT_REGEX = /\.from\s*\(\s*["']([^"']+)["']\s*\)\s*\.insert\s*\(\s*\{([^{}]*)\}\s*\)/g;

/** Encadeamento .from("T").update({ ... }) */
const FROM_UPDATE_REGEX = /\.from\s*\(\s*["']([^"']+)["']\s*\)\s*\.update\s*\(\s*\{([^{}]*)\}\s*\)/g;

/**
 * @returns {{ file: string, line: number, table: string, column: string, kind: string }[]}
 */
function collectColumnViolations(filePath, content, canonicalTables, tableColumnsMap) {
  const relPath = path.relative(ROOT, filePath);
  const violations = [];

  const checkColumns = (table, columns, kind, index) => {
    if (!VALID_TABLE_NAME.test(table)) return;
    if (ALLOWLIST.has(table)) return;
    if (!canonicalTables.has(table)) return;
    const allowedCols = tableColumnsMap.get(table);
    if (!allowedCols || allowedCols.size === 0) return;

    for (const col of columns) {
      if (!allowedCols.has(col)) {
        violations.push({
          file: relPath,
          line: lineAt(content, index),
          table,
          column: col,
          kind,
        });
      }
    }
  };

  let m;
  FROM_SELECT_REGEX.lastIndex = 0;
  while ((m = FROM_SELECT_REGEX.exec(content)) !== null) {
    const table = m[1];
    const selectArg = m[2];
    const cols = parseSelectColumns(selectArg);
    if (cols.length > 0) checkColumns(table, cols, "select", m.index);
  }

  FROM_INSERT_REGEX.lastIndex = 0;
  while ((m = FROM_INSERT_REGEX.exec(content)) !== null) {
    const table = m[1];
    const objStr = m[2];
    const keys = parseObjectLiteralKeys(objStr);
    if (keys.length > 0) checkColumns(table, keys, "insert", m.index);
  }

  FROM_UPDATE_REGEX.lastIndex = 0;
  while ((m = FROM_UPDATE_REGEX.exec(content)) !== null) {
    const table = m[1];
    const objStr = m[2];
    const keys = parseObjectLiteralKeys(objStr);
    if (keys.length > 0) checkColumns(table, keys, "update", m.index);
  }

  return violations;
}

const canonicalTables = getCanonicalTables();
const tableColumnsMap = getTableColumnsMap();
const usedTables = extractUsedTables();

const tableErrors = [];
for (const table of usedTables) {
  if (!canonicalTables.has(table) && !ALLOWLIST.has(table)) {
    tableErrors.push(table);
  }
}
tableErrors.sort((a, b) => a.localeCompare(b));

const columnViolations = [];
for (const dir of SCAN_DIRS) {
  for (const filePath of walkDir(dir, ROOT)) {
    const content = fs.readFileSync(filePath, "utf8");
    const list = collectColumnViolations(filePath, content, canonicalTables, tableColumnsMap);
    columnViolations.push(...list);
  }
}

const hasTableErrors = tableErrors.length > 0;
const hasColumnErrors = columnViolations.length > 0;

if (hasTableErrors || hasColumnErrors) {
  console.error("❌ Registry check FAILED\n");

  if (hasTableErrors) {
    console.error("Tabelas usadas no código fora do canônico:");
    for (const t of tableErrors) {
      console.error("  " + t);
    }
    console.error("");
  }

  if (hasColumnErrors) {
    console.error("Colunas inexistentes no canônico (docs/db-schema.yml):");
    for (const v of columnViolations) {
      console.error(`  ${v.file}:${v.line}  tabela "${v.table}"  coluna "${v.column}"  (${v.kind})`);
    }
  }

  process.exit(1);
}

console.log("✅ Registry check OK.");
process.exit(0);
