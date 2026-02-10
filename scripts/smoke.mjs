#!/usr/bin/env node
import { execSync } from "node:child_process";

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

try {
  run("npm run build");
  run("node scripts/db-introspect.js");

  // e2e-iot depende de segredo; se faltar, não quebra smoke local
  if (process.env.IOT_HMAC_SECRET__GW_TESTE_001 || process.env.IOT_HMAC_SECRET) {
    run("node scripts/e2e-iot.mjs");
  } else {
    console.log("[smoke] skip e2e-iot: faltou IOT_HMAC_SECRET__GW_TESTE_001 ou IOT_HMAC_SECRET");
  }

  // e2e-payments depende de env de contexto (POS + condomínio + máquina)
  run("node scripts/e2e-payments.mjs");

  console.log("\n[smoke] OK");
} catch (e) {
  console.error("\n[smoke] FAIL");
  process.exit(1);
}
