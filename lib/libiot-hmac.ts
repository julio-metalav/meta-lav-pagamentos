// lib/libiot-hmac.ts
import crypto from "crypto";

type VerifyArgs = {
  serial: string;
  ts: string;
  receivedHex: string;
  rawBody: string;
};

type VerifyResult = {
  ok: boolean;
  expected?: string;
  base?: string;
  envKey?: string;
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

  if (!serialRaw || !ts || !receivedHex) {
    return { ok: false };
  }

  const normalized = normalizeGatewaySerial(serialRaw);
  const envKey = `IOT_HMAC_SECRET__${normalized}`;
  const secret = process.env[envKey];

  if (!secret) {
    // secret não configurado no ambiente
    return { ok: false, envKey };
  }

  const base = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(base, "utf8")
    .digest("hex");

  // comparação segura contra timing attack
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(receivedHex, "hex");

  if (a.length !== b.length) {
    return { ok: false, expected, base, envKey };
  }

  const ok = crypto.timingSafeEqual(a, b);
  return { ok, expected, base, envKey };
}
