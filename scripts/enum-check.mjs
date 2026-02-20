#!/usr/bin/env node
/**
 * scripts/enum-check.mjs
 * Enum drift check v1: Phase 1 YAML ↔ DB, Phase 2 Code ↔ YAML.
 * Conservador: zero falso positivo. Escopo v1: pagamentos.status, ciclos.status.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SCOPE_V1 = {
  pagamentos: { status: { enum_name: "pag_status", values: null } },
  ciclos: { status: { enum_name: "ciclo_status", values: null } },
};

function readEnvFile(absPath) {
  const out = {};
  if (!fs.existsSync(absPath)) return out;
  const raw = fs.readFileSync(absPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEffectiveEnv() {
  const ENV = process.env.ENV || "local";
  const basePath = path.join(ROOT, ".env.local");
  let env = readEnvFile(basePath);
  if (ENV !== "local") {
    const overlay = readEnvFile(path.join(ROOT, `.env.${ENV}.local`));
    env = { ...env, ...overlay };
  }
  let SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  let SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  if (!SUPABASE_URL) SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!SUPABASE_SERVICE_ROLE_KEY)
    SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}

function getYamlEnumsScope() {
  const ymlPath = path.join(ROOT, "docs", "db-schema.yml");
  const raw = fs.readFileSync(ymlPath, "utf8");
  const doc = yaml.load(raw);
  const tables = doc?.tables || {};
  const out = { pagamentos: { status: null }, ciclos: { status: null } };
  for (const [tableName, def] of Object.entries(tables)) {
    if (tableName !== "pagamentos" && tableName !== "ciclos") continue;
    if (!def?.enums?.status) continue;
    const enumDef = def.enums.status;
    const enumName = enumDef?.enum_name ?? null;
    const values = Array.isArray(enumDef?.values) ? [...new Set(enumDef.values)] : null;
    if (out[tableName]) out[tableName].status = { enum_name: enumName, values };
  }
  return out;
}

async function phase1YamlVsDb(sb) {
  const yamlEnums = getYamlEnumsScope();
  const errors = [];

  const { data: colRows, error: colErr } = await sb
    .from("meta_columns")
    .select("table_name,column_name,udt_name")
    .eq("table_schema", "public")
    .in("table_name", ["pagamentos", "ciclos"])
    .eq("column_name", "status");

  if (colErr) {
    errors.push(`meta_columns: ${colErr.message}`);
    return { ok: false, errors };
  }

  const expectedType = {};
  for (const r of colRows ?? []) {
    const t = r.table_name;
    const expected = yamlEnums[t]?.status;
    if (!expected?.enum_name) continue;
    expectedType[t] = expected.enum_name;
    const udt = (r.udt_name || "").trim();
    if (udt !== expected.enum_name) {
      errors.push(`Coluna ${t}.status: esperado tipo "${expected.enum_name}", DB tem "${udt || "(vazio)"}"`);
    }
  }

  const enumNames = [...new Set(Object.values(expectedType))];
  if (enumNames.length === 0) return { ok: errors.length === 0, errors };

  const { data: enumRows, error: enumErr } = await sb
    .from("meta_enum_values")
    .select("enum_name,enum_value")
    .in("enum_name", enumNames);

  if (enumErr) {
    errors.push(`meta_enum_values: ${enumErr.message} (crie a view no Supabase se necessário)`);
    return { ok: false, errors };
  }

  const dbValuesByType = {};
  for (const r of enumRows ?? []) {
    const n = r.enum_name;
    if (!dbValuesByType[n]) dbValuesByType[n] = new Set();
    if (r.enum_value) dbValuesByType[n].add(String(r.enum_value).trim());
  }

  for (const [tableName, colMeta] of Object.entries(yamlEnums)) {
    if (!colMeta?.status?.values) continue;
    const expectedSet = new Set(colMeta.status.values);
    const enumName = colMeta.status.enum_name;
    const dbSet = dbValuesByType[enumName];
    if (!dbSet) {
      errors.push(`Enum ${enumName}: sem valores no DB (view meta_enum_values)`);
      continue;
    }
    const onlyYaml = [...expectedSet].filter((v) => !dbSet.has(v));
    const onlyDb = [...dbSet].filter((v) => !expectedSet.has(v));
    if (onlyYaml.length) errors.push(`Enum ${enumName}: no YAML mas não no DB: ${onlyYaml.join(", ")}`);
    if (onlyDb.length) errors.push(`Enum ${enumName}: no DB mas não no YAML: ${onlyDb.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

function* walkFiles(dir, base = ROOT) {
  const full = path.join(base, dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return;
  const skip = new Set([".git", ".next", "node_modules", "dist", "build", "coverage"]);
  const extOk = /\.(ts|tsx|js|mjs)$/i;
  const entries = fs.readdirSync(full, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(dir, e.name);
    if (e.name.startsWith(".") || skip.has(e.name)) continue;
    if (e.isDirectory()) yield* walkFiles(rel, base);
    else if (extOk.test(e.name)) yield path.join(base, rel);
  }
}

const RE_FROM = /\.from\s*\(\s*["'](pagamentos|ciclos)["']\s*\)/g;
const RE_EQ_DQ = /\.eq\s*\(\s*["']status["']\s*,\s*["']([A-Z0-9_]+)["']\s*\)/g;
const RE_EQ_SQ = /\.eq\s*\(\s*'status'\s*,\s*'([A-Z0-9_]+)'\s*\)/g;

function phase2CodeVsYaml(yamlEnums) {
  const allowed = {
    pagamentos: new Set(yamlEnums.pagamentos?.status?.values ?? []),
    ciclos: new Set(yamlEnums.ciclos?.status?.values ?? []),
  };
  const violations = [];
  const dirs = ["app", "lib", "scripts"];

  for (const dir of dirs) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const filePath of walkFiles(dir, ROOT)) {
      const content = fs.readFileSync(filePath, "utf8");
      const relPath = path.relative(ROOT, filePath);
      RE_FROM.lastIndex = 0;
      let m;
      while ((m = RE_FROM.exec(content)) !== null) {
        const table = m[1];
        const start = m.index + m[0].length;
        const nextFrom = content.indexOf(".from(", start);
        const segment = nextFrom === -1 ? content.slice(start) : content.slice(start, nextFrom);
        for (const re of [RE_EQ_DQ, RE_EQ_SQ]) {
          re.lastIndex = 0;
          let eqM;
          while ((eqM = re.exec(segment)) !== null) {
            const value = eqM[1];
            const allow = allowed[table];
            if (!allow || allow.has(value)) continue;
            const lineNum = content.slice(0, start + eqM.index).split("\n").length;
            violations.push({
              file: relPath,
              line: lineNum,
              table,
              column: "status",
              value,
              allowed: [...(allow || [])].sort().join(", "),
            });
          }
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = loadEffectiveEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[enum-check] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios (.env.local no ROOT)");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const yamlEnums = getYamlEnumsScope();

  let phase1Ok = false;
  let phase2Ok = false;

  const r1 = await phase1YamlVsDb(sb);
  phase1Ok = r1.ok;
  if (r1.ok) {
    console.log("[enum-check] Phase 1 OK (YAML ↔ DB)");
  } else {
    console.log("[enum-check] Phase 1 FAIL (YAML ↔ DB)");
    for (const e of r1.errors) console.error("  " + e);
  }

  const r2 = phase2CodeVsYaml(yamlEnums);
  phase2Ok = r2.ok;
  if (r2.ok) {
    console.log("[enum-check] Phase 2 OK (Code ↔ YAML)");
  } else {
    console.log("[enum-check] Phase 2 FAIL (Code ↔ YAML)");
    for (const v of r2.violations) {
      console.error(`  ${v.file}:${v.line}  ${v.table}.${v.column} = "${v.value}"  (permitidos: ${v.allowed})`);
    }
  }

  console.log("");
  if (phase1Ok && phase2Ok) {
    console.log("[enum-check] Resumo: OK");
    process.exit(0);
  }
  console.log("[enum-check] Resumo: FAIL");
  process.exit(1);
}

main().catch((err) => {
  console.error("[enum-check]", err.message ?? err);
  process.exit(1);
});
