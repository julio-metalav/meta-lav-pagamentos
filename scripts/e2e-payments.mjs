#!/usr/bin/env node
import crypto from "node:crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loadEnv } from "./_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadFixtures() {
  const p = path.join(ROOT, "scripts", "fixtures.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

const fixtures = loadFixtures();
const fixture = process.env.ENV && fixtures[process.env.ENV] ? fixtures[process.env.ENV] : {};
const env = loadEnv();

const BASE = process.env.BASE_URL || env.BASE_URL || "http://localhost:3000";

const POS_SERIAL = process.env.POS_SERIAL || fixture.pos_serial || "";
const IDENTIFICADOR_LOCAL = process.env.IDENTIFICADOR_LOCAL || fixture.identificador_local || "";
const CONDOMINIO_ID = process.env.CONDOMINIO_ID || fixture.condominio_id || "";
const CONDOMINIO_MAQUINAS_ID = process.env.CONDOMINIO_MAQUINAS_ID || fixture.condominio_maquinas_id || "";

const required = [
  ["POS_SERIAL", POS_SERIAL],
  ["IDENTIFICADOR_LOCAL", IDENTIFICADOR_LOCAL],
  ["CONDOMINIO_ID", CONDOMINIO_ID],
  ["CONDOMINIO_MAQUINAS_ID", CONDOMINIO_MAQUINAS_ID],
];

const missing = required.filter(([, v]) => !String(v || "").trim()).map(([k]) => k);
if (missing.length) {
  console.log(`[e2e-payments] skip: faltou env ${missing.join(", ")}`);
  process.exit(0);
}

function rndId() {
  return crypto.randomUUID();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

function assert2xx(step, r) {
  if (r.status >= 200 && r.status < 300) return;
  console.error(`\n[${step}] FAIL status=${r.status}\n${r.text}\n`);
  process.exit(1);
}

(async () => {
  const common = {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    condominio_id: CONDOMINIO_ID,
    condominio_maquinas_id: CONDOMINIO_MAQUINAS_ID,
    service_type: process.env.SERVICE_TYPE || "lavadora",
  };

  const availability = await post("/api/payments/availability", common);
  console.log("\n[availability]", availability.status, availability.text);
  assert2xx("availability", availability);

  const price = await post("/api/payments/price", { ...common, context: { coupon_code: null } });
  console.log("\n[price]", price.status, price.text);
  assert2xx("price", price);

  const quote = price.json?.quote;
  if (!quote?.quote_id) {
    console.error("\n[price] sem quote_id");
    process.exit(1);
  }

  const authIdemp = rndId();
  const authorize = await post("/api/pos/authorize", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    pos_serial: POS_SERIAL,
    identificador_local: IDENTIFICADOR_LOCAL,
    metodo: "PIX",
    idempotency_key: authIdemp,
    quote,
    metadata: { e2e: true },
  });
  console.log("\n[authorize]", authorize.status, authorize.text);
  assert2xx("authorize", authorize);

  const payment_id = authorize.json?.pagamento_id;
  if (!payment_id) {
    console.error("\n[authorize] sem pagamento_id");
    process.exit(1);
  }

  const provider_ref = `stone_e2e_${rndId()}`;
  const confirm = await post("/api/payments/confirm", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    payment_id,
    provider: "stone",
    provider_ref,
    result: "approved",
  });
  console.log("\n[confirm]", confirm.status, confirm.text);
  assert2xx("confirm", confirm);

  const execIdemp = rndId();
  const exec1 = await post("/api/payments/execute-cycle", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    idempotency_key: execIdemp,
    payment_id,
    condominio_maquinas_id: CONDOMINIO_MAQUINAS_ID,
  });
  console.log("\n[execute-cycle#1]", exec1.status, exec1.text);
  assert2xx("execute-cycle#1", exec1);

  const exec2 = await post("/api/payments/execute-cycle", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    idempotency_key: execIdemp,
    payment_id,
    condominio_maquinas_id: CONDOMINIO_MAQUINAS_ID,
  });
  console.log("\n[execute-cycle#2]", exec2.status, exec2.text);
  assert2xx("execute-cycle#2", exec2);

  const c1 = exec1.json?.cycle_id;
  const c2 = exec2.json?.cycle_id;
  const k1 = exec1.json?.command_id;
  const k2 = exec2.json?.command_id;
  if (c1 && c2 && c1 !== c2) {
    console.error(`\n[idempotency] ciclo divergente: ${c1} != ${c2}`);
    process.exit(1);
  }
  if (k1 && k2 && k1 !== k2) {
    console.error(`\n[idempotency] command divergente: ${k1} != ${k2}`);
    process.exit(1);
  }

  console.log("\n✅ E2E payments canônico OK");
})();
