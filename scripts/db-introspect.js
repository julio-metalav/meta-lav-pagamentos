// scripts/db-introspect.js
// Meta-Lav Pagamentos — Anti-ciranda: introspecta DB e compara com docs/db-schema.yml
//
// Requisitos:
// - .env.local: SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// - deps: dotenv, js-yaml, @supabase/supabase-js
// - views no Supabase (SQL):
//     - public.meta_columns (obrigatória)
//     - public.meta_enum_values (opcional, mas recomendado)
//
// Uso:
//   node scripts/db-introspect.js
//   node scripts/db-introspect.js --strict=1

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

function arg(name, fallback = null) {
  const p = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!p) return fallback;
  return p.split("=").slice(1).join("=");
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function sortAlpha(arr) {
  return [...arr].sort((a, b) => String(a).localeCompare(String(b)));
}

function die(msg) {
  console.error("❌", msg);
  process.exit(1);
}

// ENV tolerante (Next/Node)
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  die("Faltou SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no env (.env.local)");
}

const strict = arg("strict", "0") === "1";

// YAML
const ymlPath = path.join(process.cwd(), "docs", "db-schema.yml");
if (!fs.existsSync(ymlPath)) die("Não achei docs/db-schema.yml");

const doc = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const tables = doc?.tables || {};
const schema = doc?.conventions?.canonical_schema || "public";

const sb = createClient(url, key, { auth: { persistSession: false } });

// --- Introspecção via VIEW pública (PostgREST-friendly)
async function fetchColumnsForTables(tableNames) {
  const viewName = "meta_columns";

  const { data, error } = await sb
    .from(viewName)
    .select("table_name,column_name,data_type,udt_name,is_nullable")
    .eq("table_schema", schema)
    .in("table_name", tableNames);

  if (error) {
    die(
      `Erro lendo ${viewName}. ` +
        `Crie a VIEW no Supabase SQL Editor:\n` +
        `create or replace view public.meta_columns as\n` +
        `select table_schema, table_name, column_name, data_type, udt_name, is_nullable\n` +
        `from information_schema.columns\n` +
        `where table_schema='public';\n\n` +
        `Detalhe: ${error.message}`
    );
  }

  const byTable = {};
  for (const row of data || []) {
    const t = row.table_name;
    byTable[t] ??= [];
    byTable[t].push({
      column: row.column_name,
      data_type: row.data_type,
      udt_name: row.udt_name,
      nullable: row.is_nullable === "YES",
    });
  }
  return byTable;
}

// enums via view pública (opcional)
async function fetchEnumValues(enumTypeNames) {
  const viewName = "meta_enum_values";

  const { data, error } = await sb
    .from(viewName)
    .select("enum_name, enum_value, enum_order");

  if (error) {
    return { ok: false, reason: `view ${viewName} não existe ou não acessível: ${error.message}`, values: {} };
  }

  const values = {};
  for (const row of data || []) {
    if (!enumTypeNames.includes(row.enum_name)) continue;
    values[row.enum_name] ??= [];
    values[row.enum_name].push({ v: row.enum_value, o: row.enum_order });
  }

  const out = {};
  for (const [k, arr] of Object.entries(values)) {
    out[k] = arr.sort((a, b) => a.o - b.o).map((x) => x.v);
  }

  return { ok: true, values: out };
}

function normalizeDbType(row) {
  const u = String(row.udt_name || "").toLowerCase();

  if (u === "timestamptz") return "timestamptz";
  if (u === "timestamp") return "timestamp";
  if (u === "uuid") return "uuid";
  if (u === "bool" || u === "boolean") return "bool";
  if (u === "jsonb") return "jsonb";
  if (u === "int4" || u === "integer") return "int";
  if (u === "int8" || u === "bigint") return "bigint";
  if (u === "numeric") return "numeric";
  if (u === "text" || u === "varchar" || u === "bpchar") return "text";

  // enums: udt_name = nome do tipo (ex: ciclo_status)
  return row.udt_name || row.data_type || "unknown";
}

function compareTable(ymlTable, dbCols) {
  const expectedCols = Object.keys(ymlTable.columns || {});
  const dbColNames = dbCols.map((c) => c.column);

  const missingInDb = expectedCols.filter((c) => !dbColNames.includes(c));
  const extraInDb = dbColNames.filter((c) => !expectedCols.includes(c));

  const typeMismatches = [];
  for (const c of expectedCols) {
    const exp = ymlTable.columns[c];
    const db = dbCols.find((x) => x.column === c);
    if (!db) continue;

    const dbType = normalizeDbType(db);
    const expType = String(exp.type || "").toLowerCase();

    if (String(dbType).toLowerCase() !== expType) {
      typeMismatches.push({ column: c, expected: exp.type, got: dbType });
    }
  }

  return { missingInDb, extraInDb, typeMismatches };
}

async function main() {
  const ymlTables = Object.values(tables).map((t) => t.table).filter(Boolean);
  const tableNames = uniq(ymlTables);

  console.log("—".repeat(70));
  console.log("Meta-Lav Pagamentos — DB Introspect (Anti-ciranda)");
  console.log("schema:", schema, "| strict:", strict ? "ON" : "OFF");
  console.log("tabelas (YAML):", tableNames.length);
  console.log("—".repeat(70));

  const colsByTable = await fetchColumnsForTables(tableNames);

  const enumNames = [];
  for (const t of Object.values(tables)) {
    if (!t.enums) continue;
    for (const e of Object.values(t.enums)) {
      if (e?.enum_name) enumNames.push(String(e.enum_name));
    }
  }
  const enumTypeNames = sortAlpha(uniq(enumNames));
  const enumFetch = await fetchEnumValues(enumTypeNames);

  let problems = 0;

  for (const [key, t] of Object.entries(tables)) {
    const tbl = t.table;
    const dbCols = colsByTable[tbl] || [];

    if (!dbCols.length) {
      console.log(`\n❌ Tabela não encontrada/sem colunas (via meta_columns): ${key} -> ${tbl}`);
      problems++;
      continue;
    }

    const { missingInDb, extraInDb, typeMismatches } = compareTable(t, dbCols);

    const header = `\n[${key}] ${tbl}`;
    console.log(header);
    console.log("-".repeat(Math.min(70, header.length)));

    if (!missingInDb.length && !extraInDb.length && !typeMismatches.length) {
      console.log("✅ OK (colunas batem com YAML)");
    } else {
      if (missingInDb.length) {
        console.log("❌ Faltando no DB:", missingInDb.join(", "));
        problems += missingInDb.length;
      }
      if (extraInDb.length) {
        console.log("⚠️ Extras no DB (não listadas no YAML):", extraInDb.join(", "));
        if (strict) problems += extraInDb.length;
      }
      if (typeMismatches.length) {
        console.log("❌ Tipos divergentes:");
        for (const m of typeMismatches) {
          console.log(`   - ${m.column}: YAML=${m.expected} | DB=${m.got}`);
        }
        problems += typeMismatches.length;
      }
    }

    if (t.enums) {
      for (const [field, e] of Object.entries(t.enums)) {
        const enumName = e.enum_name;
        const yamlValues = e.values || [];
        if (!enumName) continue;

        if (!enumFetch.ok) {
          console.log(`⚠️ Enum check: sem view meta_enum_values; crie a view pra validar automaticamente (${enumName})`);
          continue;
        }

        const dbValues = enumFetch.values[enumName] || [];
        if (!dbValues.length) {
          console.log(`⚠️ Enum ${enumName}: não consegui ler valores (view vazia ou enum não existe)`);
          continue;
        }

        const missEnum = yamlValues.filter((v) => !dbValues.includes(v));
        const extraEnum = dbValues.filter((v) => !yamlValues.includes(v));

        if (!missEnum.length && !extraEnum.length) {
          console.log(`✅ Enum ${enumName} (${field}): OK`);
        } else {
          if (missEnum.length) {
            console.log(`❌ Enum ${enumName}: YAML tem valores que NÃO existem no DB: ${missEnum.join(", ")}`);
            problems += missEnum.length;
          }
          if (extraEnum.length) {
            console.log(`⚠️ Enum ${enumName}: DB tem valores que NÃO estão no YAML: ${extraEnum.join(", ")}`);
            if (strict) problems += extraEnum.length;
          }
        }
      }
    }
  }

  console.log("\n" + "—".repeat(70));
  if (problems === 0) {
    console.log("✅ RESULTADO: sem divergências relevantes.");
    process.exit(0);
  } else {
    console.log(`❌ RESULTADO: divergências encontradas: ${problems}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌ Falha inesperada:", e);
  process.exit(1);
});
