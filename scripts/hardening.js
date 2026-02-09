#!/usr/bin/env node
/*
 * Hardening básico para rotas API.
 * 1) app/api não pode conter "use client" nem JSX.
 * 2) rotas iot só podem importar de @/lib/iot ou @/lib/db (além de next/*).
 */
const fs = require("fs");
const path = require("path");

const apiRoot = path.resolve(process.cwd(), "app", "api");
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

function isIotRoute(file) {
  return file.includes(`${path.sep}app${path.sep}api${path.sep}iot${path.sep}`);
}

function findImports(content) {
  const out = [];
  const re = /import\s+[^;]*?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
}

if (!fs.existsSync(apiRoot)) {
  console.log("[hardening] app/api não encontrado; skip");
  process.exit(0);
}

const files = walk(apiRoot);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);

  if (/['"]use client['"]/.test(content)) {
    violations.push(`${rel}: contém 'use client'`);
  }

  // em app/api, rotas devem ser .ts/.js (sem JSX)
  if (rel.startsWith(`app${path.sep}api`) && (rel.endsWith('.tsx') || rel.endsWith('.jsx'))) {
    violations.push(`${rel}: extensão JSX não permitida em app/api`);
  }

  if (isIotRoute(file)) {
    const imports = findImports(content);
    for (const imp of imports) {
      if (imp.startsWith("next/")) continue;
      if (imp.startsWith("@/lib/iot/") || imp === "@/lib/iot") continue;
      if (imp.startsWith("@/lib/db/") || imp === "@/lib/db") continue;
      // permitir bridge temporária até migração completa
      if (imp === "@/lib/iot/service") continue;
      violations.push(`${rel}: import não permitido em rota IoT -> ${imp}`);
    }
  }
}

if (violations.length) {
  console.error("[hardening] Violações encontradas:");
  for (const v of violations) console.error(` - ${v}`);
  process.exit(1);
}

console.log("[hardening] OK");
