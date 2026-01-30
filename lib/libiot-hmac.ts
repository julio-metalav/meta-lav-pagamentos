// lib/libiot-hmac.ts
import crypto from "crypto";

type VerifyArgs = {
  serial: string;
  ts: string;
  receivedHex: string;
  rawBody: string;
};

export type VerifyDebug = {
  serial_raw: string;
  serial_norm: string;
  env_key: string;
  has_secret: boolean;
  ts: string;
  base: string;
  expected?: string;
  received?: string;
};

export type VerifyResult = {
  ok: boolean;
  debug: VerifyDebug;
};

/**
 * Normaliza serial para uso em env vars (Vercel-safe)
 * Ex: "GW-TESTE-001" -> "GW_TESTE_001"
 */
export function normalizeGatewaySerial(serial: string) {
  return (serial || "").replace(/[^A-Za-z0-9_]/g, "_");
}

export function verifyHmac(args: VerifyArgs): VerifyResult {
  const serialRaw = (args.serial || "").trim();
  const ts = (args.ts || "").trim();
  const receivedHex = (args.receivedHex || "").trim().toLowerCase();
  const rawBody = args.rawBody ?? "";

  const serialNorm = normalizeGatewaySerial(serialRaw);
  const envKey = `IOT_HMAC_SECRET__${serialNorm}`;

  const base = `${ts}.${rawBody}`;
  const secret = process.env[envKey];

  const debug: VerifyDebug = {
    serial_raw: serialRaw,
    serial_norm: serialNorm,
    env_key: envKey,
    has_secret: !!secret,
    ts,
    base,
  };

  if (!serialRaw || !ts || !receivedHex || !secret) {
    debug.received = receivedHex || "";
    return { ok: false, debug };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(base, "utf8")
    .digest("hex");

  debug.expected = expected;
  debug.received = receivedHex;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(receivedHex, "hex");

  if (a.length !== b.length) {
    return { ok: false, debug };
  }

  const ok = crypto.timingSafeEqual(a, b);
  return { ok, debug };
}
