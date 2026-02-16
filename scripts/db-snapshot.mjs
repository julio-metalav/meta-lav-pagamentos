#!/usr/bin/env node
/**
 * scripts/db-snapshot.mjs
 * Dashboard Nexus — Snapshot determinístico do schema Supabase (read-only).
 *
 * Saída:
 *   - docs/_snapshots/DB_SCHEMA_SNAPSHOT.json
 *   - docs/_snapshots/DB_SCHEMA_SNAPSHOT.md
 *
 * Regras:
 *   - Só consome endpoints read-only (RPC + views meta_*)
 *   - Falha se SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY faltarem
 *   - Gera arquivos determinísticos para auditoria do dashboard
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();

const envPaths = [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")];
envPaths.forEach((p) => {
  if (fs.existsSync(p)) dotenv.config({ path: p });
});

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error("❌ Faltou SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL)");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Faltou SUPABASE_SERVICE_ROLE_KEY (service role)");
  process.exit(1);
}

const SAFE_MODE = String(process.env.DB_SNAPSHOT_SAFE_MODE || "on").toLowerCase() !== "off";
const TARGET_SCHEMA = process.env.SUPABASE_SCHEMA || "public";
const DEFAULT_TABLES = [
  "pagamentos",
  "ciclos",
  "iot_commands",
  "eventos_iot",
  "gateways",
  "pos_devices",
  "condominio_maquinas",
  "precos_ciclo",
];

const TARGET_TABLES = (process.env.DB_SNAPSHOT_TABLES || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

const TABLES = (TARGET_TABLES.length ? TARGET_TABLES : DEFAULT_TABLES)
  .map((t) => t.trim())
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));

const SNAPSHOT_DIR = path.join(ROOT, "docs", "_snapshots");
const JSON_OUT = path.join(SNAPSHOT_DIR, "DB_SCHEMA_SNAPSHOT.json");
const MD_OUT = path.join(SNAPSHOT_DIR, "DB_SCHEMA_SNAPSHOT.md");

if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function git(cmd, fallback = "") {
  try {
    return execSync(cmd, { cwd: ROOT }).toString().trim();
  } catch (err) {
    return fallback;
  }
}

const gitMeta = {
  branch: git("git rev-parse --abbrev-ref HEAD", "unknown"),
  commit: git("git rev-parse HEAD", "unknown"),
  shortCommit: git("git rev-parse --short HEAD", "unknown"),
};

async function fetchEnums() {
  const { data, error } = await sb.from("meta_enum_values").select(
    "enum_name,enum_value,enum_order"
  );
  if (error) {
    console.warn(
      "⚠️  Não consegui ler meta_enum_values (enums). Resultado ficará sem valores explícitos.",
      error.message
    );
    return {};
  }
  const map = {};
  for (const row of data || []) {
    map[row.enum_name] ??= [];
    map[row.enum_name].push({ value: row.enum_value, order: row.enum_order });
  }
  for (const [name, arr] of Object.entries(map)) {
    const values = arr.map((x) => x.value).filter(Boolean);
    values.sort((a, b) => a.localeCompare(b));
    map[name] = values;
  }
  return map;
}

async function fetchViaRpc(tables) {
  try {
    const payload = {
      target_schema: TARGET_SCHEMA,
      target_tables: tables.length ? tables : null,
    };
    const { data, error } = await sb.rpc("nexus_db_schema_snapshot", payload);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) return null;
    return { rows: data, source: "rpc" };
  } catch (err) {
    console.warn(
      "⚠️  RPC nexus_db_schema_snapshot indisponível. Fallback para meta_columns.",
      err.message
    );
    return null;
  }
}

async function fetchViaView(tables) {
  const { data, error } = await sb
    .from("meta_columns")
    .select("table_name,column_name,data_type,udt_name,is_nullable")
    .eq("table_schema", TARGET_SCHEMA)
    .in("table_name", tables);

  if (error) {
    throw new Error(
      `Falha lendo meta_columns (crie a view conforme docs/db-introspect.js): ${error.message}`
    );
  }

  return {
    rows: data || [],
    source: "meta_columns",
  };
}

function normalize(rows, enumMap) {
  const byTable = {};
  for (const raw of rows) {
    const table = raw.table_name;
    if (!TABLES.includes(table)) continue;
    byTable[table] ??= [];
    let enumValues = raw.enum_values || enumMap[raw.udt_name] || null;
    if (Array.isArray(enumValues)) {
      enumValues = [...new Set(enumValues)].sort((a, b) => a.localeCompare(b));
    }
    byTable[table].push({
      name: raw.column_name,
      dataType: raw.data_type,
      pgType: raw.udt_name,
      isNullable:
        typeof raw.is_nullable === "boolean"
          ? raw.is_nullable
          : String(raw.is_nullable).toUpperCase() === "YES",
      defaultValue: raw.column_default ?? null,
      isIdentity: Boolean(raw.is_identity),
      ordinal: raw.ordinal_position ?? null,
      enumValues,
    });
  }

  for (const cols of Object.values(byTable)) {
    cols.sort((a, b) => {
      if (a.ordinal != null && b.ordinal != null) return a.ordinal - b.ordinal;
      if (a.ordinal != null) return -1;
      if (b.ordinal != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  return byTable;
}

function buildMarkdown(meta, tables) {
  const lines = [];
  lines.push(`# Snapshot do Schema — Dashboard Nexus`);
  lines.push("");
  lines.push(`- Branch: ${meta.git.branch}`);
  lines.push(`- Commit: ${meta.git.commit}`);
  lines.push(`- Schema: ${meta.schema}`);
  lines.push(`- Safe mode: ${meta.safe_mode ? "ON" : "OFF"}`);
  lines.push(`- Fonte: ${meta.source}`);
  lines.push(`- Ambiente(s): ${meta.environments.join(", ")}`);
  lines.push("");
  lines.push(`Tabelas monitoradas: ${TABLES.join(", ")}`);
  lines.push("\n---\n");

  for (const name of TABLES) {
    const cols = tables[name] || [];
    lines.push(`## ${name}`);
    if (!cols.length) {
      lines.push(`⚠️  Nenhuma coluna retornada (verifique permissões no Supabase).`);
      lines.push("\n---\n");
      continue;
    }
    lines.push(`| Coluna | Tipo Postgres | Nullable | Default | Enum |`);
    lines.push(`|---|---|---|---|---|`);
    for (const col of cols) {
      const nullable = col.isNullable ? "✅" : "❌";
      const defVal = col.defaultValue ? `\`${col.defaultValue}\`` : "-";
      const enumLabel = col.enumValues ? col.enumValues.join(", ") : "-";
      lines.push(
        `| \`${col.name}\` | ${col.pgType || col.dataType} | ${nullable} | ${defVal} | ${enumLabel} |`
      );
    }
    lines.push("\n---\n");
  }

  lines.push("\n> SQL auxiliar para RPC read-only: docs/_snapshots/rpc_nexus_db_schema_snapshot.sql");

  return lines.join("\n");
}

async function main() {
  if (!SAFE_MODE) {
    console.warn("⚠️  Safe mode desativado — verifique se isso é realmente necessário.");
  }

  const enumMap = await fetchEnums();

  let fetchResult = await fetchViaRpc(TABLES);
  if (!fetchResult) {
    fetchResult = await fetchViaView(TABLES);
  }

  const byTable = normalize(fetchResult.rows, enumMap);

  const metadata = {
    schema: TARGET_SCHEMA,
    tables: [...TABLES],
    source: fetchResult.source,
    safe_mode: SAFE_MODE,
    git: {
      branch: gitMeta.branch,
      commit: gitMeta.commit,
      shortCommit: gitMeta.shortCommit,
    },
    environments: ["https://ci.metalav.com.br", "https://api.metalav.com.br"],
  };

  const orderedTables = {};
  for (const name of TABLES) {
    orderedTables[name] = byTable[name] || [];
  }

  const payload = {
    metadata,
    tables: orderedTables,
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2));
  const md = buildMarkdown(metadata, orderedTables);
  fs.writeFileSync(MD_OUT, md, "utf8");

  console.log("✅ Snapshot gerado:", JSON_OUT);
  console.log("✅ Snapshot markdown:", MD_OUT);
}

main().catch((err) => {
  console.error("❌ Falha ao gerar snapshot:", err.message);
  process.exit(1);
});
