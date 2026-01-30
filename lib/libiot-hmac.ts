// lib/libiot-hmac.ts
import crypto from "crypto";

export type HmacDebug = {
  serial: string;
  serialNorm: string;
  ts: string;
  rawBodyLen: number;
  rawBodyHead: string;

  secretSource: string;
  envHasGeneric: boolean;
  envHasPerSerial: boolean;

  baseHead: string;

  expectedHead: string;
  receivedHead: string;
};

function normSerial(serial: string) {
  return (serial || "").replace(/[^a-zA-Z0-9]/g, "_");
}

function safeLowerHex(s: string) {
  return (s || "").trim().toLowerCase();
}

function hexToBuf(hex: string) {
  const clean = safeLowerHex(hex);
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) return null;
  try {
    return Buffer.from(clean, "hex");
  } catch {
    return null;
  }
}

function timingSafeEqualHex(aHex: string, bHex: string) {
  const a = hexToBuf(aHex);
  const b = hexToBuf(bHex);
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function getIotHmacSecret(serial: string) {
  const serialNorm = normSerial(serial);
  const perKey = `IOT_HMAC_SECRET__${serialNorm}`;

  const per = process.env[perKey];
  if (per && per.length > 0) {
    return { secret: per, source: perKey, serialNorm };
  }

  const generic = process.env.IOT_HMAC_SECRET;
  if (generic && generic.length > 0) {
    return { secret: generic, source: "IOT_HMAC_SECRET", serialNorm };
  }

  return { secret: "", source: "missing", serialNorm };
}

export function computeExpectedHmacHex(params: {
  secret: string;
  ts: string;
  rawBody: string;
}) {
  const base = `${params.ts}.${params.rawBody}`;
  const h = crypto.createHmac("sha256", Buffer.from(params.secret, "utf8"));
  h.update(Buffer.from(base, "utf8"));
  return { expectedHex: h.digest("hex"), base };
}

export function verifyHmac(params: {
  serial: string;
  ts: string;
  receivedHex: string;
  rawBody: string;
}) {
  const { secret, source, serialNorm } = getIotHmacSecret(params.serial);

  const envHasGeneric = !!process.env.IOT_HMAC_SECRET;
  const envHasPerSerial = !!process.env[`IOT_HMAC_SECRET__${serialNorm}`];

  const { expectedHex, base } = computeExpectedHmacHex({
    secret,
    ts: params.ts,
    rawBody: params.rawBody,
  });

  const ok =
    secret.length > 0 && timingSafeEqualHex(expectedHex, params.receivedHex);

  const debug: HmacDebug = {
    serial: params.serial,
    serialNorm,
    ts: params.ts,
    rawBodyLen: params.rawBody.length,
    rawBodyHead: params.rawBody.slice(0, 120),

    secretSource: source,
    envHasGeneric,
    envHasPerSerial,

    baseHead: base.slice(0, 200),

    expectedHead: expectedHex.slice(0, 12),
    receivedHead: safeLowerHex(params.receivedHex).slice(0, 12),
  };

  return { ok, debug, expectedHex };
}
