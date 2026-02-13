// lib/app/auth.ts
export type AppUserToken = {
  sub: string; // user id
  tel: string;
  role: "app_user";
  exp: number; // epoch seconds
  iat: number; // epoch seconds
};

function base64url(input: Buffer | string) {
  const raw = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input).toString("base64");
  return raw.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getJwtSecret(): string {
  const s = process.env.APP_JWT_SECRET;
  if (s && s.trim().length >= 16) return s.trim();
  // Dev fallback: generate ephemeral secret per process (warn)
  const generated = globalThis as any;
  if (!generated.__APP_JWT_SECRET_DEV__) {
    const rnd = Math.random().toString(36).slice(2) + Date.now().toString(36);
    generated.__APP_JWT_SECRET_DEV__ = `dev-only-${rnd}`;
    console.warn("[APP_AUTH] APP_JWT_SECRET ausente. Usando segredo efêmero de DEV nesta sessão. Adicione APP_JWT_SECRET ao .env.local para persistência.");
  }
  return generated.__APP_JWT_SECRET_DEV__ as string;
}

export function signAppJwt(payload: Omit<AppUserToken, "iat" | "exp"> & { expSec?: number }): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (payload.expSec ?? 60 * 60 * 24 * 7); // 7d default
  const body: AppUserToken = { sub: payload.sub, tel: payload.tel, role: "app_user", iat: now, exp };
  const encHeader = base64url(JSON.stringify(header));
  const encBody = base64url(JSON.stringify(body));
  const toSign = `${encHeader}.${encBody}`;
  const secret = getJwtSecret();
  const crypto = require("crypto");
  const sig = crypto.createHmac("sha256", secret).update(toSign, "utf8").digest();
  const encSig = base64url(sig);
  return `${toSign}.${encSig}`;
}

export function verifyAppJwt(token: string): { ok: true; payload: AppUserToken } | { ok: false; reason: string } {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return { ok: false, reason: "token_malformed" };
    const secret = getJwtSecret();
    const crypto = require("crypto");
    const expected = base64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`, "utf8").digest());
    if (expected !== s) return { ok: false, reason: "token_invalid_sig" };
    const payload = JSON.parse(Buffer.from(p, "base64").toString("utf8")) as AppUserToken;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) return { ok: false, reason: "token_expired" };
    if (payload.role !== "app_user") return { ok: false, reason: "token_invalid_role" };
    return { ok: true, payload };
  } catch (e: any) {
    return { ok: false, reason: "token_verify_error" };
  }
}

export async function getAppUser(req: Request, sb: any): Promise<{ ok: true; user: any } | { ok: false; status: number; error: string }>{
  const authz = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: "missing_bearer" };
  const token = m[1].trim();
  const v = verifyAppJwt(token);
  if (!v.ok) return { ok: false, status: 401, error: v.reason };
  const id = v.payload.sub;
  const { data, error } = await sb.from("usuarios_app").select("id, telefone, telefone_norm, nome, condominio_id, status").eq("id", id).maybeSingle();
  if (error) return { ok: false, status: 500, error: "db_error" };
  if (!data) return { ok: false, status: 401, error: "user_not_found" };
  if (String(data.status || "").toLowerCase() === "bloqueado") return { ok: false, status: 403, error: "user_blocked" };
  return { ok: true, user: data };
}
