export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { hashPassword, signSession, validatePassword, verifyPassword } from "@/lib/admin/auth";

const COOKIE_NAME = "admin_session";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60, // 1h
  };
}

async function ensureBootstrapGestor(sb: any, email: string, password: string) {
  const bootEmail = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
  const bootPass = String(process.env.ADMIN_BOOTSTRAP_PASS || "");
  if (!bootEmail || !bootPass) return { ok: false as const, reason: "missing_bootstrap_env" };
  if (email !== bootEmail) return { ok: false as const, reason: "email_mismatch" };
  if (password !== bootPass) return { ok: false as const, reason: "bad_password" };

  const { data: anyUser } = await sb.from("admin_users").select("id").limit(1);
  if (anyUser && anyUser.length > 0) return { ok: false as const, reason: "already_initialized" };

  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return { ok: false as const, reason: `password_policy:${pwCheck.reason}` };

  const passHash = hashPassword(password);

  const { data: role } = await sb.from("admin_roles").select("id").eq("code", "GESTOR").maybeSingle();
  if (!role?.id) return { ok: false as const, reason: "missing_role_gestor" };

  const { data: user, error: uErr } = await sb
    .from("admin_users")
    .insert({ email, enabled: true, status: "active", password_hash: passHash })
    .select("id,email")
    .maybeSingle();

  if (uErr || !user?.id) return { ok: false as const, reason: uErr?.message || "create_user_failed" };

  await sb.from("admin_user_roles").insert({ user_id: user.id, role_id: role.id });
  await sb.from("admin_audit_log").insert({ actor_user_id: user.id, action: "bootstrap_gestor", target_user_id: user.id, meta: { email } });

  return { ok: true as const, user_id: user.id };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) return jsonErrorCompat("email e password são obrigatórios.", 400, { code: "validation_error" });

    const secret = String(process.env.ADMIN_SESSION_SECRET || "");
    if (!secret) return jsonErrorCompat("ADMIN_SESSION_SECRET não configurado.", 500, { code: "misconfig" });

    const sb = supabaseAdmin() as any;

    // Bootstrap (first ever login)
    const boot = await ensureBootstrapGestor(sb, email, password);
    if (boot.ok) {
      const exp = Date.now() + 60 * 60 * 1000;
      const token = signSession({ user_id: boot.user_id, exp }, secret);
      const res = NextResponse.json({ ok: true, bootstrapped: true });
      res.cookies.set(COOKIE_NAME, token, cookieOptions());
      return res;
    }

    const { data: user, error } = await sb
      .from("admin_users")
      .select("id,email,enabled,status,password_hash")
      .eq("email", email)
      .maybeSingle();

    if (error) return jsonErrorCompat("Erro ao autenticar.", 500, { code: "db_error", extra: { details: error.message } });
    if (!user || !user.enabled || String(user.status) !== "active") return jsonErrorCompat("Acesso negado.", 401, { code: "unauthorized" });

    const ok = verifyPassword(password, user.password_hash);
    if (!ok) return jsonErrorCompat("Acesso negado.", 401, { code: "unauthorized" });

    await sb.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

    const exp = Date.now() + 60 * 60 * 1000;
    const token = signSession({ user_id: user.id, exp }, secret);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, cookieOptions());
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no login.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
