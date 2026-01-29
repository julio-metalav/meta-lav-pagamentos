import crypto from "crypto";

export type IoTAuthResult =
  | { ok: true; serial: string }
  | { ok: false; status: number; error: string; debug?: any };

function bad(status: number, error: string, debug?: any): IoTAuthResult {
  const enableDebug = process.env.IOT_DEBUG_HMAC === "true";
  return enableDebug ? { ok: false, status, error, debug } : { ok: false, status, error };
}

/**
 * Assinatura: HMAC(secret, `${ts}.${rawBody}`)
 * - rawBody deve ser o corpo CRU (string) lido NO route.ts (req.text()).
 */
export function authenticateGateway(req: Request, rawBody: string): IoTAuthResult {
  const serial = (req.headers.get("x-gw-serial") ?? "").trim();
  const tsHeader = (req.headers.get("x-gw-ts") ?? "").trim();
  const sign = (req.headers.get("x-gw-sign") ?? "").trim();

  if (!serial) return bad(401, "Header ausente: x-gw-serial");
  if (!tsHeader) return bad(401, "Header ausente: x-gw-ts");
  if (!sign) return bad(401, "Header ausente: x-gw-sign");

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return bad(401, "Timestamp inválido");

  const secret = process.env.IOT_SHARED_SECRET;
  if (!secret) return bad(500, "IOT_SHARED_SECRET não configurado");

  // Timestamp (DEV pode desligar)
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.IOT_HMAC_TTL_SECONDS ?? "3600");

  if (process.env.IOT_DISABLE_TIMESTAMP_CHECK !== "true") {
    const diff = Math.abs(now - ts);
    if (diff > ttl) {
      return bad(401, `Timestamp fora da janela (replay/clock skew). now=${now} ts=${ts} diff=${diff}s ttl=${ttl}s`);
    }
  }

  const base = `${ts}.${rawBody ?? ""}`;
  const expected = crypto.createHmac("sha256", secret).update(base).digest("hex");

  if (expected !== sign) {
    return bad(401, "Assinatura inválida (HMAC)", {
      ts,
      serial,
      rawBody,
      base,
      expected,
      received: sign,
      secret_first6: secret.slice(0, 6),
    });
  }

  return { ok: true, serial };
}
