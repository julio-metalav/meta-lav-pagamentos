// lib/iotAuth.ts
import { verifyHmac } from "@/lib/libiot-hmac";

type Ok = { ok: true; serial: string };
type Fail = { ok: false; status: number; error: string };
export type AuthResult = Ok | Fail;

export function authenticateGateway(req: Request, rawBody: string): AuthResult {
  const serial = req.headers.get("x-gw-serial") || "";
  const ts = req.headers.get("x-gw-ts") || "";
  const sign = req.headers.get("x-gw-sign") || "";

  if (!serial || !ts || !sign) {
    return { ok: false, status: 400, error: "headers_missing" };
  }

  const { ok } = verifyHmac({
    serial,
    ts,
    receivedHex: sign,
    rawBody,
  });

  if (!ok) {
    return { ok: false, status: 401, error: "invalid_hmac" };
  }

  return { ok: true, serial };
}
