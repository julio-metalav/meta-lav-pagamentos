#!/usr/bin/env node
/*
 * Falha se rotas runtime consultarem tabelas legado EN.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.cwd(), "app", "api");

const banned = [
  "sales",
  "payments",
  "machines",
  "gateway_commands",
  "iot_events",
  "iot_acks_legacy",
];

const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

function hasBannedRef(content, token) {
  // Mantém checagem focada em acesso de tabela/query para evitar falso positivo de rota/path.
  const patterns = [
    `.from("${token}")`,
    `.from('${token}')`,
    `.eq("table","${token}")`,
    `.eq('table','${token}')`,
    `from ${token}`,
  ];
  return patterns.some((p) => content.includes(p));
}

if (!fs.existsSync(root)) {
  console.log("[anti-legado] app/api não encontrado; skip");
  process.exit(0);
}

const files = walk(root);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const token of banned) {
    if (hasBannedRef(content, token)) {
      violations.push({ file, token });
    }
  }
}

if (violations.length) {
  console.error("[anti-legado] Encontradas referências proibidas em rotas runtime:");
  for (const v of violations) {
    console.error(` - ${path.relative(process.cwd(), v.file)} -> ${v.token}`);
  }
  process.exit(1);
}

console.log("[anti-legado] OK");
