#!/usr/bin/env node
/**
 * scripts/registry-check.mjs
 * Falha se alguma tabela usada via .from("...") no código não estiver
 * declarada como canonical: true em docs/db-schema.yml.
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

function extractUsedTables() {
  const used = new Set();
  for (const dir of SCAN_DIRS) {
    for (const filePath of walkDir(dir, ROOT)) {
      const content = fs.readFileSync(filePath, "utf8");
      let m;
      FROM_REGEX.lastIndex = 0;
      while ((m = FROM_REGEX.exec(content)) !== null) {
        const name = m[1];
        if (VALID_TABLE_NAME.test(name)) used.add(name);
      }
    }
  }
  return used;
}

const canonicalTables = getCanonicalTables();
const usedTables = extractUsedTables();

const errors = [];
for (const table of usedTables) {
  if (!canonicalTables.has(table) && !ALLOWLIST.has(table)) {
    errors.push(table);
  }
}

errors.sort((a, b) => a.localeCompare(b));

if (errors.length > 0) {
  console.error("❌ Registry check FAILED");
  console.error("Tabelas usadas no código fora do canônico:\n");
  for (const t of errors) {
    console.error("  " + t);
  }
  process.exit(1);
}

console.log("✅ Registry check OK.");
process.exit(0);
