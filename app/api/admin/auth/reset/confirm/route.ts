export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { hashPassword, sha256Hex, signSession, validatePassword } from "@/lib/admin/auth";

const COOKIE_NAME = "admin_session";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");

    if (!token || !password) return jsonErrorCompat("token e password são obrigatórios.", 400, { code: "validation_error" });

    const secret = String(process.env.ADMIN_SESSION_SECRET || "");
    if (!secret) return jsonErrorCompat("ADMIN_SESSION_SECRET não configurado.", 500, { code: "misconfig" });

    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) return jsonErrorCompat("Senha inválida pela política.", 400, { code: "password_policy", extra: { reason: pwCheck.reason } });

    const sb = supabaseAdmin() as any;
    const tokenHash = sha256Hex(token);

    const { data: row, error } = await sb
      .from("admin_auth_tokens")
      .select("id,user_id,type,expires_at,used_at")
      .eq("token_hash", tokenHash)
      .eq("type", "reset")
      .maybeSingle();

    if (error) return jsonErrorCompat("Erro ao validar token.", 500, { code: "db_error", extra: { details: error.message } });
    if (!row) return jsonErrorCompat("Token inválido.", 400, { code: "invalid_token" });
    if (row.used_at) return jsonErrorCompat("Token já usado.", 400, { code: "token_used" });
    if (new Date(row.expires_at).getTime() < Date.now()) return jsonErrorCompat("Token expirado.", 400, { code: "token_expired" });

    const passHash = hashPassword(password);

    await sb.from("admin_users").update({ password_hash: passHash, status: "active" }).eq("id", row.user_id);
    await sb.from("admin_auth_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    await sb.from("admin_audit_log").insert({ actor_user_id: row.user_id, action: "reset_password", target_user_id: row.user_id, meta: {} });

    const exp = Date.now() + 60 * 60 * 1000;
    const sessionToken = signSession({ user_id: row.user_id, exp }, secret);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, sessionToken, cookieOptions());
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no reset.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
