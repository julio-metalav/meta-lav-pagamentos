import fs from "fs";
import crypto from "crypto";

function fail(msg, body) {
  console.error("\n[FAIL]", msg);
  if (body) console.error(body);
  process.exit(1);
}

function loadEnvLocal() {
  const p = ".env.local";
  if (!fs.existsSync(p)) {
    console.log("[env] .env.local não encontrado — usando process.env (CI mode)");
    return;
  }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    let [key, ...rest] = line.split("=");
    let val = rest.join("=").trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key.trim()] = val;
  }
}

// Load env first (hardened)
loadEnvLocal();

const BASE = process.env.BASE_URL || "http://localhost:3000";
const POS_SERIAL = process.env.POS_SERIAL || "POS-TESTE-001";
const IDENTIFICADOR_LOCAL = process.env.IDENTIFICADOR_LOCAL || "LAV-01";
const VALOR_CENTAVOS = Number(process.env.VALOR_CENTAVOS || 1600);
const METODO = process.env.METODO || "PIX"; // "PIX" | "CARTAO"
const CONDOMINIO_MAQUINAS_ID = process.env.CONDOMINIO_MAQUINAS_ID || "";

const GW_SERIAL = process.env.GW_SERIAL || process.env.GATEWAY_SERIAL || "GW-TESTE-001";
const GW_ID = process.env.GATEWAY_ID || "";

const serialNorm = GW_SERIAL.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const HMAC_SECRET = process.env[`IOT_HMAC_SECRET__${serialNorm}`] || process.env.IOT_HMAC_SECRET || "";

function sign(ts, bodyStr) {
  return crypto.createHmac("sha256", HMAC_SECRET).update(`${GW_SERIAL}.${ts}.${bodyStr}`).digest("hex");
}

async function callJson(path, method = "GET", bodyObj = undefined) {
  const headers = { };
  if (bodyObj) headers["content-type"] = "application/json";
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
  if (bodyObj) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: bodyObj ? bodyStr : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

async function callFinancial() {
  if (!CONDOMINIO_MAQUINAS_ID) fail("Env CONDOMINIO_MAQUINAS_ID é obrigatório");
  // 1) authorize
  console.log("\n[authorize] calling /api/pos/authorize...");
  const auth = await callJson("/api/pos/authorize", "POST", {
    pos_serial: POS_SERIAL,
    identificador_local: IDENTIFICADOR_LOCAL,
    valor_centavos: VALOR_CENTAVOS,
    metodo: METODO,
  });
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

  return {
    pagamento_id,
    cycle_id: String(exec.json.cycle_id || ""),
    command_id: String(exec.json.command_id || ""),
  };
}

async function main() {
  console.log(`[env] BASE=${BASE}`);
  console.log(`[env] POS_SERIAL=${POS_SERIAL} IDENTIFICADOR_LOCAL=${IDENTIFICADOR_LOCAL} VALOR_CENTAVOS=${VALOR_CENTAVOS} METODO=${METODO}`);
  console.log(`[env] CONDOMINIO_MAQUINAS_ID=${CONDOMINIO_MAQUINAS_ID}`);
  console.log(`[env] GW_SERIAL=${GW_SERIAL} GATEWAY_ID=${GW_ID}`);

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

  // 5) ack (HMAC)
  console.log("\n[ack] calling /api/iot/ack (HMAC)...");
  const nowTs = Math.floor(Date.now() / 1000);
  const ack = await callIoT("/api/iot/ack", "POST", { cmd_id, ok: true, ts: nowTs, machine_id: IDENTIFICADOR_LOCAL });
  console.log("[ack] status=", ack.status, ack.text);
  if (ack.status < 200 || ack.status >= 300) fail("ack falhou", ack.text);

  // 6) evento (HMAC)
  console.log("\n[evento] calling /api/iot/evento (HMAC)...");
  const ev = await callIoT("/api/iot/evento", "POST", { ts: nowTs, machine_id: IDENTIFICADOR_LOCAL, type: "PULSE" });
  console.log("[evento] status=", ev.status, ev.text);
  if (ev.status < 200 || ev.status >= 300) fail("evento falhou", ev.text);

  console.log("\n✅ E2E FULL OK", { pagamento_id: fin.pagamento_id, cycle_id: fin.cycle_id, command_id: cmd_id });
}

main().catch((e) => fail("unhandled exception", e?.stack || String(e)));
