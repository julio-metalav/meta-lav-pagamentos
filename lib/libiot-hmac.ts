// lib/libiot-hmac.ts
// DEPRECATED: wrapper de compatibilidade.
// Fonte única de autenticação HMAC: lib/iotAuth.ts

import { authenticateGateway } from "@/lib/iotAuth";

type VerifyArgs = {
  serial: string;
  ts: string;
  receivedHex: string;
  rawBody: string;
};

export type VerifyDebug = {
  serial: string;
  ts: string;
  rawBodyLen: number;
  error?: string;
};

export type VerifyResult = {
  ok: boolean;
  debug: VerifyDebug;
};

/**
 * Compat API para código legado.
 * Internamente delega 100% para authenticateGateway (fonte única).
 */
export function verifyHmac(args: VerifyArgs): VerifyResult {
  const headers = new Headers({
    "x-gw-serial": args.serial ?? "",
    "x-gw-ts": args.ts ?? "",
    "x-gw-sign": args.receivedHex ?? "",
  });

  const req = new Request("http://local/iot/hmac-check", {
    method: "POST",
    headers,
    body: args.rawBody ?? "",
  });

  const auth = authenticateGateway(req, args.rawBody ?? "");

  return {
    ok: auth.ok,
    debug: {
      serial: String(args.serial ?? ""),
      ts: String(args.ts ?? ""),
      rawBodyLen: Buffer.byteLength(args.rawBody ?? "", "utf8"),
      ...(auth.ok ? {} : { error: auth.error }),
    },
  };
}
