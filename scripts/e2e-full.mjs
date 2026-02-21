import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { loadEnv } from "./_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function fail(msg, body) {
  console.error("\n[FAIL]", msg);
  if (body) console.error(body);
  process.exit(1);
}

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
const POS_SERIAL = process.env.POS_SERIAL || fixture.pos_serial || "POS-TESTE-001";
const IDENTIFICADOR_LOCAL = process.env.IDENTIFICADOR_LOCAL || fixture.identificador_local || "LAV-01";
const VALOR_CENTAVOS = Number(process.env.VALOR_CENTAVOS || 1600);
const METODO = process.env.METODO || "PIX"; // "PIX" | "CARTAO"
const CONDOMINIO_MAQUINAS_ID = process.env.CONDOMINIO_MAQUINAS_ID || fixture.condominio_maquinas_id || "";

const GW_SERIAL = process.env.GW_SERIAL || process.env.GATEWAY_SERIAL || fixture.gw_serial || "GW-TESTE-001";
const GW_ID = process.env.GATEWAY_ID || "";

const serialNorm = GW_SERIAL.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const HMAC_SECRET = process.env[`IOT_HMAC_SECRET__${serialNorm}`] || process.env.IOT_HMAC_SECRET || "";

// Optional: Vercel Protection Bypass (staging)
const STAGING_VERCEL_BYPASS_TOKEN = process.env.STAGING_VERCEL_BYPASS_TOKEN || "";
const MANUAL_CONFIRM = process.env.MANUAL_CONFIRM === "1";
const INTERNAL_MANUAL_TOKEN = process.env.INTERNAL_MANUAL_TOKEN || process.env.MANUAL_INTERNAL_TOKEN || "";
const MANUAL_METODO = (process.env.MANUAL_METODO || "STONE_OFFLINE").toUpperCase();
const MANUAL_REF_PREFIX = process.env.MANUAL_REF_PREFIX || "manual-ci";

const SUPABASE_URL_RAW = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_URL = SUPABASE_URL_RAW.replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail("Env SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para o E2E");
}

const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;
const SUPABASE_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const WAIT_RETRIES = Number(process.env.E2E_SUPABASE_RETRIES || 15);
const WAIT_DELAY_MS = Number(process.env.E2E_SUPABASE_DELAY_MS || 1000);


function sign(ts, bodyStr) {
  return crypto.createHmac("sha256", HMAC_SECRET).update(`${GW_SERIAL}.${ts}.${bodyStr}`).digest("hex");
}

async function callJson(path, method = "GET", bodyObj = undefined, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (STAGING_VERCEL_BYPASS_TOKEN) headers["x-vercel-protection-bypass"] = STAGING_VERCEL_BYPASS_TOKEN;
  if (bodyObj && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

async function callIoT(path, method = "GET", bodyObj = undefined) {
  if (!HMAC_SECRET) fail(`HMAC secret ausente para serial ${GW_SERIAL} (defina IOT_HMAC_SECRET__${serialNorm} ou IOT_HMAC_SECRET)`);
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers = { "x-gw-serial": GW_SERIAL, "x-gw-ts": ts, "x-gw-sign": sign(ts, bodyStr) };
  if (STAGING_VERCEL_BYPASS_TOKEN) headers["x-vercel-protection-bypass"] = STAGING_VERCEL_BYPASS_TOKEN;
  if (bodyObj) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: bodyObj ? bodyStr : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}


async function supabaseSelect(table, params = {}, { single = false } = {}) {
  const base = SUPABASE_REST_URL;
  const url = new URL(`${base.replace(/\/+$/, "")}/${table}`);
  const entries = params || {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, value);
  }
  if (!url.searchParams.has("select")) url.searchParams.set("select", "*");
  const res = await fetch(url, { headers: SUPABASE_HEADERS });
  const text = await res.text();
  if (!res.ok) fail(`[supabase ${table}] ${res.status} ${text}`);
  const data = text ? JSON.parse(text) : [];
  if (single) {
    if (Array.isArray(data)) return data[0] ?? null;
    return data;
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(label, fn, opts = {}) {
  const retries = opts.retries ?? WAIT_RETRIES;
  const delayMs = opts.delayMs ?? WAIT_DELAY_MS;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ok = await fn();
    if (ok) return;
    if (attempt < retries) await sleep(delayMs);
  }
  fail(`${label} não atingiu o estado esperado após ${retries} tentativas`);
}

async function expectIotCommandStatus(cmdId, expectedStatuses, opts = {}) {
  const allow = (Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]).map((s) => String(s).toUpperCase());
  await waitForCondition(`iot_commands:${cmdId}:${allow.join("|")}`, async () => {
    const row = await supabaseSelect(
      "iot_commands",
      { select: "cmd_id,status,ack_at", cmd_id: `eq.${cmdId}` },
      { single: true }
    );
    if (!row) return false;
    const current = String(row.status || "").toUpperCase();
    if (!allow.includes(current)) return false;
    if (opts.requireAckAt && !row.ack_at) return false;
    return true;
  }, opts);
}

async function expectCycleStatus(cycleId, expectedStatus, opts = {}) {
  const target = String(expectedStatus).toUpperCase();
  const guards = {
    LIBERADO: (row) => !!row.pulso_enviado_at,
    EM_USO: (row) => !!row.busy_on_at,
    FINALIZADO: (row) => !!row.busy_off_at,
  };
  await waitForCondition(`ciclos:${cycleId}:${target}`, async () => {
    const row = await supabaseSelect(
      "ciclos",
      { select: "id,status,pulso_enviado_at,busy_on_at,busy_off_at", id: `eq.${cycleId}` },
      { single: true }
    );
    if (!row) return false;
    const current = String(row.status || "").toUpperCase();
    if (current !== target) return false;
    const guard = guards[target];
    if (guard && !guard(row)) return false;
    return true;
  }, opts);
}



function randomRef() {
  return `${MANUAL_REF_PREFIX}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function callManualConfirmFlow() {
  if (!CONDOMINIO_MAQUINAS_ID) fail("Env CONDOMINIO_MAQUINAS_ID é obrigatório");
  if (!INTERNAL_MANUAL_TOKEN) fail("INTERNAL_MANUAL_TOKEN obrigatório para MANUAL_CONFIRM=1");

  const ref_externa = randomRef();
  console.log("\n[manual.confirm] calling /api/manual/confirm ...");
  const resp = await callJson(
    "/api/manual/confirm",
    "POST",
    {
      pos_serial: POS_SERIAL,
      condominio_maquinas_id: CONDOMINIO_MAQUINAS_ID,
      valor_centavos: VALOR_CENTAVOS,
      metodo: MANUAL_METODO,
      identificador_local: IDENTIFICADOR_LOCAL,
      ref_externa,
      observacao: "E2E manual confirm",
    },
    { headers: { "x-internal-token": INTERNAL_MANUAL_TOKEN } }
  );
  console.log("[manual.confirm] status=", resp.status, resp.text);
  if (resp.status < 200 || resp.status >= 300 || !resp.json?.pagamento_id) fail("manual/confirm falhou", resp.text);
  const cycle_id = String(resp.json.cycle_id || "");
  const command_id = String(resp.json.command_id || "");
  if (!cycle_id) fail("manual/confirm não retornou cycle_id", resp.text);
  if (!command_id) fail("manual/confirm não retornou command_id", resp.text);
  return {
    pagamento_id: String(resp.json.pagamento_id),
    cycle_id,
    command_id,
  };
}

async function callFinancial() {
  if (MANUAL_CONFIRM) {
    return callManualConfirmFlow();
  }
  if (!CONDOMINIO_MAQUINAS_ID) fail("Env CONDOMINIO_MAQUINAS_ID é obrigatório");
  if (!POS_SERIAL || String(POS_SERIAL).trim() === "") {
    fail("POS_SERIAL vazio ou ausente (obrigatório para x-pos-serial no authorize). Defina STAGING_POS_SERIAL no GitHub Actions.");
  }
  // 1) authorize (x-pos-serial é header obrigatório)
  const posSerialValue = String(POS_SERIAL).trim();
  console.log("\n[authorize] calling /api/pos/authorize...", "x-pos-serial length=" + posSerialValue.length);
  const authHeaders = { "x-pos-serial": posSerialValue };
  const authBody = {
    identificador_local: IDENTIFICADOR_LOCAL,
    valor_centavos: VALOR_CENTAVOS,
    metodo: METODO,
    pos_serial: posSerialValue,
  };
  const auth = await callJson("/api/pos/authorize", "POST", authBody, { headers: authHeaders });
  console.log("[authorize] status=", auth.status, auth.text);
  if (auth.status < 200 || auth.status >= 300 || !auth.json?.pagamento_id) fail("authorize falhou", auth.text);
  const pagamento_id = String(auth.json.pagamento_id);

  // 2) confirm
  console.log("\n[confirm] calling /api/payments/confirm...");
  const provider_ref = `stone_pos_${crypto.randomUUID()}`;
  const conf = await callJson("/api/payments/confirm", "POST", {
    payment_id: pagamento_id,
    provider: "stone",
    provider_ref,
    result: "approved",
  });
  console.log("[confirm] status=", conf.status, conf.text);
  if (conf.status < 200 || conf.status >= 300) fail("confirm falhou", conf.text);

  // 3) execute-cycle
  console.log("\n[execute-cycle] calling /api/payments/execute-cycle...");
  const exec_key = `e2e:${pagamento_id}`;
  const exec = await callJson("/api/payments/execute-cycle", "POST", {
    payment_id: pagamento_id,
    condominio_maquinas_id: CONDOMINIO_MAQUINAS_ID,
    idempotency_key: exec_key,
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
  });
  console.log("[execute-cycle] status=", exec.status, exec.text);
  if (exec.status < 200 || exec.status >= 300 || !exec.json?.command_id) fail("execute-cycle falhou", exec.text);

  const cycle_id = String(exec.json?.cycle_id || "");
  const command_id = String(exec.json?.command_id || "");
  if (!cycle_id) fail("execute-cycle não retornou cycle_id", exec.text);
  if (!command_id) fail("execute-cycle não retornou command_id", exec.text);

  return { pagamento_id, cycle_id, command_id };
}

async function main() {
  console.log(`[env] BASE=${BASE}`);
  console.log(`[env] POS_SERIAL=${POS_SERIAL} IDENTIFICADOR_LOCAL=${IDENTIFICADOR_LOCAL} VALOR_CENTAVOS=${VALOR_CENTAVOS} METODO=${METODO}`);
  console.log(`[env] CONDOMINIO_MAQUINAS_ID=${CONDOMINIO_MAQUINAS_ID}`);
  console.log(`[env] GW_SERIAL=${GW_SERIAL} GATEWAY_ID=${GW_ID}`);
  if (MANUAL_CONFIRM) console.log(`[mode] MANUAL_CONFIRM=1 (metodo=${MANUAL_METODO})`);

  const fin = await callFinancial();
  console.log("\n[financial OK]", fin);

  // 4) poll (HMAC)
  if (!GW_ID) fail("GATEWAY_ID obrigatório para IoT poll");
  console.log("\n[poll] calling /api/iot/poll (HMAC)...");
  const poll = await callIoT(`/api/iot/poll?gateway_id=${encodeURIComponent(GW_ID)}`, "GET");
  console.log("[poll] status=", poll.status, poll.text);
  if (poll.status < 200 || poll.status >= 300) fail("poll falhou", poll.text);

  // aceitar tanto objeto único quanto lista em commands
  const commands = poll.json?.commands || [];
  let cmd_id = fin.command_id;
  if (!cmd_id) {
    const c0 = Array.isArray(commands) ? commands[0] : commands;
    cmd_id = c0?.cmd_id || c0?.id || c0?.command_id || "";
  }
  if (!cmd_id) fail("nenhum cmd_id encontrado no poll nem do execute-cycle", JSON.stringify(poll.json));
  await expectIotCommandStatus(cmd_id, "ENVIADO");


  // 5) ack (HMAC)
  console.log("\n[ack] calling /api/iot/ack (HMAC)...");
  const nowTs = Math.floor(Date.now() / 1000);
  const ack = await callIoT("/api/iot/ack", "POST", { cmd_id, ok: true, ts: nowTs, machine_id: IDENTIFICADOR_LOCAL });
  console.log("[ack] status=", ack.status, ack.text);
  if (ack.status < 200 || ack.status >= 300) fail("ack falhou", ack.text);

  await expectIotCommandStatus(cmd_id, "ACK", { requireAckAt: true });

  // 6) eventos (HMAC)
  console.log("\n[evento] calling /api/iot/evento (PULSE)...");
  const pulseTs = Math.floor(Date.now() / 1000);
  const pulse = await callIoT("/api/iot/evento", "POST", { ts: pulseTs, machine_id: IDENTIFICADOR_LOCAL, cmd_id, type: "PULSE", pulses: 1 });
  console.log("[evento:PULSE] status=", pulse.status, pulse.text);
  if (pulse.status < 200 || pulse.status >= 300) fail("evento PULSE falhou", pulse.text);
  await expectIotCommandStatus(cmd_id, "EXECUTADO");
  await expectCycleStatus(fin.cycle_id, "LIBERADO");

  console.log("\n[evento] calling /api/iot/evento (BUSY_ON)...");
  const busyOnTs = Math.floor(Date.now() / 1000);
  const busyOn = await callIoT("/api/iot/evento", "POST", { ts: busyOnTs, machine_id: IDENTIFICADOR_LOCAL, cmd_id, type: "BUSY_ON" });
  console.log("[evento:BUSY_ON] status=", busyOn.status, busyOn.text);
  if (busyOn.status < 200 || busyOn.status >= 300) fail("evento BUSY_ON falhou", busyOn.text);
  await expectCycleStatus(fin.cycle_id, "EM_USO");

  console.log("\n[evento] calling /api/iot/evento (BUSY_OFF)...");
  const busyOffTs = Math.floor(Date.now() / 1000);
  const busyOff = await callIoT("/api/iot/evento", "POST", { ts: busyOffTs, machine_id: IDENTIFICADOR_LOCAL, cmd_id, type: "BUSY_OFF" });
  console.log("[evento:BUSY_OFF] status=", busyOff.status, busyOff.text);
  if (busyOff.status < 200 || busyOff.status >= 300) fail("evento BUSY_OFF falhou", busyOff.text);
  await expectCycleStatus(fin.cycle_id, "FINALIZADO");

  console.log("\n✅ E2E FULL OK", { pagamento_id: fin.pagamento_id, cycle_id: fin.cycle_id, command_id: cmd_id });
}

main().catch((e) => fail("unhandled exception", e?.stack || String(e)));
