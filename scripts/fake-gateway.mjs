#!/usr/bin/env node
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseFixtureArg() {
  const i = process.argv.indexOf("--fixture");
  if (i === -1) return null;
  return process.argv[i + 1] || process.env.ENV || null;
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

const fixtureName = parseFixtureArg() || process.env.ENV;
const fixtures = loadFixtures();
const fixture = fixtureName && fixtures[fixtureName] ? fixtures[fixtureName] : {};

const env = loadEnv({
  validateFakeGateway: true,
  gwSerial: process.env.GW_SERIAL || fixture.gw_serial || "GW-FAKE-001",
});

const BASE_URL = process.env.BASE_URL || env.BASE_URL || "https://ci.metalav.com.br";
const GW_SERIAL = process.env.GW_SERIAL || fixture.gw_serial || "GW-FAKE-001";
const serialNorm = GW_SERIAL.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const IOT_HMAC_SECRET =
  process.env[`IOT_HMAC_SECRET__${serialNorm}`] || process.env.IOT_HMAC_SECRET || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const BUSY_ON_MS = Number(process.env.BUSY_ON_MS || 7000);
const LIMIT = Number(process.env.LIMIT || 5);
const CHAOS_MODE = (process.env.CHAOS_MODE || "off").toLowerCase() === "on";
const CHAOS_DROP_ACK_RATE = Number(process.env.CHAOS_DROP_ACK_RATE || 0.1);
const CHAOS_DELAY_MS = Number(process.env.CHAOS_DELAY_MS || 400);
const HEARTBEAT_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

if (!IOT_HMAC_SECRET) {
  console.error(
    `[fake-gateway] Missing IOT_HMAC_SECRET__${serialNorm} (ou IOT_HMAC_SECRET). Defina no .env do ambiente (ex: .env.ci.local para ENV=ci).`
  );
  process.exit(1);
}

const startTime = Date.now();
let lastHeartbeatAt = 0;
let stopRequested = false;

process.on("SIGINT", () => {
  console.log("\n[fake-gateway] Caught SIGINT, shutting down gracefully...");
  stopRequested = true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (base = 0) => (CHAOS_MODE ? Math.floor(Math.random() * (CHAOS_DELAY_MS + 1)) : 0) + base;
const uptimeSeconds = () => Math.floor((Date.now() - startTime) / 1000);

function logStep(step, { cmd_id = "-", machine_id = "-", status = "-", info = "" } = {}) {
  console.log(`[${new Date().toISOString()}] step=${step} cmd=${cmd_id} machine=${machine_id} status=${status} info=${info}`);
}

function signRequest(ts, rawBody) {
  const stringToSign = `${GW_SERIAL}.${ts}.${rawBody}`;
  return crypto.createHmac("sha256", IOT_HMAC_SECRET).update(stringToSign).digest("hex");
}

async function signedFetch(path, { method = "GET", body = null } = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), FETCH_TIMEOUT_MS);
  const ts = Math.floor(Date.now() / 1000).toString();
  const rawBody = body ? JSON.stringify(body) : "";
  const headers = {
    "x-gw-serial": GW_SERIAL,
    "x-gw-ts": ts,
    "x-gw-sign": signRequest(ts, rawBody),
  };
  if (body) headers["content-type"] = "application/json";

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? rawBody : undefined,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(path, options = {}) {
  let attempt = 0;
  let lastError = null;
  while (attempt < MAX_RETRIES) {
    try {
      const res = await signedFetch(path, options);
      if (res.status === 401 || res.status === 403) {
        const text = await res.text();
        throw new Error(`Auth/HMAC error (${res.status}): ${text}`);
      }
      if (res.status === 404) {
        const text = await res.text();
        throw new Error(`Resource not found (${res.status}): ${text}`);
      }
      if (res.status >= 500) {
        const text = await res.text();
        throw new Error(`Server error (${res.status}): ${text}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt >= MAX_RETRIES || (err && err.message && err.message.includes("Auth/HMAC"))) {
        throw err;
      }
      await sleep([250, 750, 1500][Math.min(attempt - 1, 2)]);
    }
  }
  throw lastError;
}

async function requestJson(path, options = {}) {
  const res = await fetchWithRetry(path, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text || "{}");
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return json;
}

async function sendHeartbeat() {
  const body = {
    sim: "fake-gateway",
    uptime_s: uptimeSeconds(),
    ts: Math.floor(Date.now() / 1000),
  };
  try {
    const res = await fetchWithRetry("/api/iot/heartbeat", { method: "POST", body });
    logStep("heartbeat", { status: res.status });
  } catch (err) {
    logStep("heartbeat_fail", { status: "error", info: err.message });
  }
}

/** Simula confirmação de pagamento no backend (CRIADO → PAGO) para permitir execute-cycle em seguida. */
async function sendFakeConfirm() {
  try {
    const res = await fetchWithRetry("/api/dev/fake-gateway-confirm", { method: "POST", body: {} });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text || "{}");
    } catch {}
    if (res.status === 200 && json.confirmed) {
      logStep("fake_confirm", { status: res.status, info: `payment_id=${json.payment_id ?? "-"}` });
    }
  } catch (err) {
    if (!err.message?.includes("404") && !err.message?.includes("only_allowed_in_preview")) {
      logStep("fake_confirm_fail", { status: "error", info: err.message });
    }
  }
}

function extractMachineId(command) {
  const payload = command?.payload || {};
  return (
    payload.machine_id ||
    payload.identificador_local ||
    payload.maquina_id ||
    payload.deviceId ||
    "LAV-FAKE-01"
  );
}

function extractCycleId(command) {
  const payload = command?.payload || {};
  return (
    payload.ciclo_id ||
    payload.cycle_id ||
    payload?.ciclo?.id ||
    payload?.ciclo?.ciclo_id ||
    payload?.command?.cycle_id ||
    "unknown"
  );
}

async function handleCommand(command) {
  const cmd_id = command?.cmd_id || command?.id;
  if (!cmd_id) {
    logStep("command_skip", { info: "missing cmd_id" });
    return;
  }
  const machine_id = extractMachineId(command);
  const cycle_id = extractCycleId(command);

  if (CHAOS_MODE && Math.random() < CHAOS_DROP_ACK_RATE) {
    logStep("ack_skip", { cmd_id, machine_id, info: "chaos mode drop" });
    return;
  }

  const ackBody = {
    cmd_id,
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    machine_id,
  };

  await sleep(jitter());
  const ackRes = await fetchWithRetry("/api/iot/ack", { method: "POST", body: ackBody });
  logStep("ack", { cmd_id, machine_id, status: ackRes.status, info: `cycle=${cycle_id}` });

  const events = [
    { type: "PULSO_ENVIADO", label: "pulse", extra: { pulses: 1 } },
    { type: "BUSY_ON", label: "busy_on" },
    { type: "BUSY_OFF", label: "busy_off", delayBefore: BUSY_ON_MS },
  ];

  for (const event of events) {
    if (event.delayBefore) {
      await sleep(event.delayBefore + jitter());
    } else {
      await sleep(jitter());
    }

    const body = {
      type: event.type,
      cmd_id,
      machine_id,
      ts: Math.floor(Date.now() / 1000),
      ...event.extra,
    };
    const res = await fetchWithRetry("/api/iot/evento", { method: "POST", body });
    logStep(event.label, { cmd_id, machine_id, status: res.status, info: `cycle=${cycle_id}` });
  }
}

async function loop() {
  while (!stopRequested) {
    const now = Date.now();
    if (now - lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
      await sendHeartbeat();
      lastHeartbeatAt = Date.now();
    }

    await sendFakeConfirm();

    let pollJson;
    try {
      pollJson = await requestJson(`/api/iot/poll?limit=${LIMIT}`, { method: "GET" });
    } catch (err) {
      logStep("poll_fail", { status: "error", info: err.message });
      if (err.message.includes("gateway_not_found")) {
        console.error("[fake-gateway] Gateway not found. Ensure GW_SERIAL exists in the database.");
        process.exit(1);
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const commands = pollJson?.commands || [];
    if (!Array.isArray(commands) || commands.length === 0) {const headers = {
  "x-gw-serial": GW_SERIAL, // Aqui o serial é configurado
  "x-gw-ts": ts,
  "x-gw-sign": signRequest(ts, rawBody),
};const headers = {
  "x-gw-serial": GW_SERIAL, // Aqui o serial é configurado
  "x-gw-ts": ts,
  "x-gw-sign": signRequest(ts, rawBody),
};
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    for (const command of commands) {
      try {
        await handleCommand(command);
      } catch (err) {
        logStep("command_error", {
          cmd_id: command?.cmd_id,
          status: "error",
          info: err.message,
        });
      }
      if (stopRequested) break;
    }
  }
}

(async () => {
  logStep("start", {
    info: `BASE_URL=${BASE_URL} GW_SERIAL=${GW_SERIAL} CHAOS_MODE=${CHAOS_MODE ? "on" : "off"}`,
  });
  try {
    await loop();
  } catch (err) {
    console.error(`[fake-gateway] Fatal error: ${err.message}`);
    process.exit(1);
  }
  console.log("[fake-gateway] stopped.");
})();
