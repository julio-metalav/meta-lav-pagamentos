import crypto from "crypto";
import fs from "fs";
import path from "path";
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
const serial = process.env.GW_SERIAL || fixture.gw_serial || "GW-TESTE-001";

const serialNorm = serial.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const secret =
  process.env[`IOT_HMAC_SECRET__${serialNorm}`] ||
  process.env.IOT_HMAC_SECRET ||
  "";

if (!secret) {
  console.error("Faltou secret. Defina IOT_HMAC_SECRET__" + serialNorm + " ou IOT_HMAC_SECRET no .env do ambiente.");
  process.exit(1);
}

function sign(ts, bodyStr) {
  return crypto.createHmac("sha256", secret).update(`${serial}.${ts}.${bodyStr}`).digest("hex");
}

async function call(path, method, bodyObj) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers = { "x-gw-serial": serial, "x-gw-ts": ts, "x-gw-sign": sign(ts, bodyStr) };
  if (bodyObj) headers["content-type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, { method, headers, body: bodyObj ? bodyStr : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

function okOrThrow(step, r) {
  if (r.status >= 200 && r.status < 300) return;
  console.error(`\n[${step}] FAIL status=${r.status}\n${r.text}\n`);
  process.exit(1);
}

(async () => {
  const pollPath = process.env.GATEWAY_ID
    ? `/api/iot/poll?gateway_id=${process.env.GATEWAY_ID}`
    : "/api/iot/poll";
  const poll = await call(pollPath, "GET");
  console.log("\n[poll]", poll.status, poll.text);
  okOrThrow("poll", poll);

  const cmd = (poll.json?.commands?.[0]) || poll.json?.command || poll.json?.cmd || poll.json || null;
  const cmd_id = cmd?.cmd_id || cmd?.id || cmd?.command_id || (Array.isArray(cmd) ? (cmd[0]?.cmd_id || cmd[0]?.id) : null);
  if (!cmd_id) {
    console.error("\n[poll] sem cmd_id");
    process.exit(1);
  }

  const ack = await call("/api/iot/ack", "POST", { cmd_id, ok: true, ts: Math.floor(Date.now() / 1000), machine_id: "LAV-01" });
  console.log("\n[ack]", ack.status, ack.text);
  okOrThrow("ack", ack);

  for (const tipo of ["PULSE", "BUSY_ON", "BUSY_OFF"]) {
    const ev = await call("/api/iot/evento", "POST", { ts: Math.floor(Date.now() / 1000), machine_id: "LAV-01", type: tipo });
    console.log(`\n[evento ${tipo}]`, ev.status, ev.text);
    okOrThrow(`evento ${tipo}`, ev);
  }

  console.log("\n✅ E2E mínimo OK");
})();
