// lib/iotAuth.ts
import crypto from "crypto";

type AuthOk = {
  ok: true;
  serial: string;
};

type AuthFail = {
  ok: false;
  status: number;
  error: string;
  detail?: string;
};

function safeSerialToEnvKey(serial: string) {
  // GW-TESTE-001 -> GW_TESTE_001
  return serial.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function timingSafeEqualHex(aHex: string, bHex: string) {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * authenticateGateway
 * Headers esperados:
 * - x-gw-serial
 * - x-gw-ts (unix seconds)
 * - x-gw-sign (hex hmac sha256)
 *
 * StringToSign (canônico):
 *   `${serial}.${ts}.${rawBody}`
 *
 * Secret:
 * - Exclusivamente process.env[`IOT_HMAC_SECRET__${SERIAL_SANITIZADO}`]
 * - Sem fallback; se ausente → 500 missing_secret com detail=envKey
 */
export function authenticateGateway(req: Request, rawBody: string): AuthOk | AuthFail {
  const serial = (req.headers.get("x-gw-serial") || "").trim();
  const tsStr = (req.headers.get("x-gw-ts") || "").trim();
  const sign = (req.headers.get("x-gw-sign") || "").trim().toLowerCase();

  if (!serial) return { ok: false, status: 401, error: "missing_serial" };
  if (!tsStr) return { ok: false, status: 401, error: "missing_ts" };
  if (!sign) return { ok: false, status: 401, error: "missing_sign" };

  const ts = Number.parseInt(tsStr, 10);
  if (!Number.isFinite(ts)) return { ok: false, status: 401, error: "invalid_ts" };

  // anti-replay: tolerância (10 min)
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);
  if (skew > 600) {
    return { ok: false, status: 401, error: "ts_skew", detail: `skew=${skew}s` };
  }

  const envKey = `IOT_HMAC_SECRET__${safeSerialToEnvKey(serial)}`;
  const secret = process.env[envKey];

  if (!secret) {
    return { ok: false, status: 500, error: "missing_secret", detail: envKey };
  }

  const stringToSign = `${serial}.${ts}.${rawBody ?? ""}`;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(stringToSign, "utf8")
    .digest("hex")
    .toLowerCase();

  if (!timingSafeEqualHex(sign, expected)) {
    return { ok: false, status: 401, error: "invalid_hmac" };
  }

  return { ok: true, serial };
}
