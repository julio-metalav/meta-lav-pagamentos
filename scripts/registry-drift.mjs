#!/usr/bin/env node
/**
 * scripts/registry-drift.mjs
 * Drift report (informativo): compara colunas do banco (meta_columns) com
 * docs/db-schema.yml. Exit 0 sempre; no futuro pode passar a exit(1).
 * ENV é lido deterministicamente dos arquivos .env*.local no ROOT (não confia em process.env).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Lê arquivo .env; retorna {} se não existir.
 * Linhas vazias e comentários (#) ignorados.
 * Parse KEY=VALUE; remove aspas simples/duplas em volta do valor.
 * @param {string} absPath
 * @returns {{ [k: string]: string }}
 */
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

/**
 * Carrega env determinístico: base = .env.local, overlay = .env.${ENV}.local se ENV !== "local".
 * Fallback para process.env só para SUPABASE_URL e SERVICE_ROLE_KEY se ausentes; loga "from shell".
 * @returns {{ SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string, envFilesUsed: string[] }}
 */
function loadEffectiveEnv() {
  const ENV = process.env.ENV || "local";
  const envFilesUsed = [];
  const basePath = path.join(ROOT, ".env.local");
  let env = readEnvFile(basePath);
  if (Object.keys(env).length > 0) envFilesUsed.push(basePath);

  if (ENV !== "local") {
    const overlayPath = path.join(ROOT, `.env.${ENV}.local`);
    const overlay = readEnvFile(overlayPath);
    if (Object.keys(overlay).length > 0) {
      envFilesUsed.push(overlayPath);
      env = { ...env, ...overlay };
    }
  }

  let SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  let SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";

  if (!SUPABASE_URL) {
    SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    if (SUPABASE_URL) console.warn("[registry-drift] SUPABASE_URL veio do shell (process.env)");
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
    if (SUPABASE_SERVICE_ROLE_KEY) console.warn("[registry-drift] SUPABASE_SERVICE_ROLE_KEY veio do shell (process.env)");
  }

  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, envFilesUsed, ENV };
}

const effective = loadEffectiveEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, envFilesUsed, ENV } = effective;

const supabaseUrlHost = SUPABASE_URL ? (() => { try { return new URL(SUPABASE_URL).host; } catch { return "-"; } })() : "-";

console.log("[registry-drift] ENV:", ENV);
console.log("[registry-drift] envFilesUsed:", envFilesUsed.length ? envFilesUsed : "(nenhum)");
console.log("[registry-drift] SUPABASE_URL host:", supabaseUrlHost);
console.log("[registry-drift] SRK presente:", !!SUPABASE_SERVICE_ROLE_KEY);
console.log("");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios (.env.local no ROOT)");
  process.exit(0);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SCHEMA = "public";
const PAGE = 1000;

/** @returns {Map<string, Set<string>>} table -> Set(column names) */
function getYamlColumns() {
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

/** @returns {Map<string, Set<string>>} table -> Set(column names) */
async function getDbColumns() {
  const map = new Map();
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await sb
      .from("meta_columns")
      .select("table_name,column_name")
      .eq("table_schema", SCHEMA)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("❌ Erro ao ler meta_columns:");
      console.error("   code:", error.code ?? "(n/a)");
      console.error("   message:", error.message);
      console.error("   details:", error.details ?? "(n/a)");
      console.error("   SUPABASE_URL host em uso:", supabaseUrlHost);
      return map;
    }
    if (!data?.length) break;
    for (const row of data) {
      const t = row.table_name;
      const c = row.column_name;
      if (t && c) {
        if (!map.has(t)) map.set(t, new Set());
        map.get(t).add(c);
      }
    }
    hasMore = data.length === PAGE;
    from += PAGE;
  }
  return map;
}

function run() {
  return new Promise((resolve) => {
    (async () => {
      const yamlCols = getYamlColumns();
      const dbCols = await getDbColumns();

      const allTables = new Set([...yamlCols.keys(), ...dbCols.keys()]);
      const tablesSorted = [...allTables].sort((a, b) => a.localeCompare(b));

      const drifts = [];
      let totalDbOnly = 0;
      let totalYamlOnly = 0;

      for (const table of tablesSorted) {
        const yc = yamlCols.get(table) ?? new Set();
        const dc = dbCols.get(table) ?? new Set();
        const dbOnly = [...dc].filter((c) => !yc.has(c)).sort((a, b) => a.localeCompare(b));
        const yamlOnly = [...yc].filter((c) => !dc.has(c)).sort((a, b) => a.localeCompare(b));
        if (dbOnly.length === 0 && yamlOnly.length === 0) continue;
        totalDbOnly += dbOnly.length;
        totalYamlOnly += yamlOnly.length;
        drifts.push({ table, dbOnly, yamlOnly });
      }

      console.log("DRIFT REPORT (public) — banco vs docs/db-schema.yml\n");

      if (drifts.length === 0) {
        console.log("✅ No drift detected.");
        resolve();
        return;
      }

      for (const { table, dbOnly, yamlOnly } of drifts) {
        console.log(`--- ${table}`);
        if (dbOnly.length > 0) {
          console.log("  DB_ONLY:  " + dbOnly.join(", "));
        }
        if (yamlOnly.length > 0) {
          console.log("  YAML_ONLY: " + yamlOnly.join(", "));
        }
        console.log("");
      }

      console.log("--- Resumo");
      console.log(`  Tabelas comparadas: ${tablesSorted.length}`);
      console.log(`  Tabelas com drift:  ${drifts.length}`);
      console.log(`  Total colunas DB_ONLY:  ${totalDbOnly}`);
      console.log(`  Total colunas YAML_ONLY: ${totalYamlOnly}`);
      resolve();
    })();
  });
}

run().then(() => process.exit(0));
