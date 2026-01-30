// lib/libiot-hmac.ts
import crypto from "crypto";

type VerifyArgs = {
  serial: string;
  ts: string;
  receivedHex: string;
  rawBody: string;
};

export type VerifyDebug = {
  // esperados pelos endpoints
  serial: string;
  serialNorm: string;
  ts: string;
  rawBodyLen: number;

  // compat com logs antigos
  secretSource: "per-serial" | "generic" | "missing";
  expectedHead: string;
  receivedHead: string;
  envHasGeneric: boolean;

  // extras (sem vazar secret)
  envKey: string;
  hasSecret: boolean;
  base: string;
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

function head(s: string, n = 12) {
  return (s || "").slice(0, n);
}

export function verifyHmac(args: VerifyArgs): VerifyResult {
  const serial = (args.serial || "").trim();
  const ts = (args.ts || "").trim();
  const receivedHex = (args.receivedHex || "").trim().toLowerCase();
  const rawBody = args.rawBody ?? "";

  const serialNorm = normalizeGatewaySerial(serial);

  const perSerialKey = `IOT_HMAC_SECRET__${serialNorm}`;
  const genericKey = `IOT_HMAC_SECRET`; // fallback (se existir), sem IOT_SHARED_SECRET

  const perSerialSecret = process.env[perSerialKey];
  const genericSecret = process.env[genericKey];

  // prioridade: per-serial; fallback: generic (se alguém usar em dev)
  const secret =
    perSerialSecret ?? genericSecret ?? undefined;

  const secretSource: VerifyDebug["secretSource"] =
    perSerialSecret ? "per-serial" : genericSecret ? "generic" : "missing";

  const base = `${ts}.${rawBody}`;

  // expected só se tiver secret e headers mínimos
  let expected = "";
  if (serial && ts && receivedHex && secret) {
    expected = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
  }

  const debug: VerifyDebug = {
    serial,
    serialNorm,
    ts,
    rawBodyLen: Buffer.byteLength(rawBody, "utf8"),

    secretSource,
    expectedHead: head(expected),
    receivedHead: head(receivedHex),
    envHasGeneric: !!genericSecret,

    envKey: perSerialKey,
    hasSecret: !!secret,
    base,
  };

  // Falhas básicas
  if (!serial || !ts || !receivedHex || !secret) {
    return { ok: false, debug };
  }

  // comparação segura
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(receivedHex, "hex");
  if (a.length !== b.length) return { ok: false, debug };

  const ok = crypto.timingSafeEqual(a, b);
  return { ok, debug };
}
