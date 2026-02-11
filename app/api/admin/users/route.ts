export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { requireAdminSession, requirePermission, getAdminPermissions } from "@/lib/admin/server";
import { randomToken, sha256Hex } from "@/lib/admin/auth";

function appUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "").startsWith("http")
    ? String(process.env.NEXT_PUBLIC_APP_URL || "")
    : `https://${process.env.VERCEL_URL}`;
}

export async function GET() {
  const sess = await requireAdminSession();
  if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });

  const ok = await requirePermission(sess.user.id, "admin.users.read");
  if (!ok) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

  const sb = supabaseAdmin() as any;
  const { data, error } = await sb
    .from("admin_users")
    .select("id,email,name,enabled,status,created_at,last_login_at")
    .order("created_at", { ascending: false });

  if (error) return jsonErrorCompat("Erro ao listar usuários.", 500, { code: "db_error", extra: { details: error.message } });

  return NextResponse.json({ ok: true, items: data || [] });
}

export async function POST(req: Request) {
  const sess = await requireAdminSession();
  if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });

  const ok = await requirePermission(sess.user.id, "admin.users.write");
  if (!ok) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim() || null;

  if (!email) return jsonErrorCompat("email é obrigatório", 400, { code: "validation_error" });

  const sb = supabaseAdmin() as any;

  const { data: user, error: uErr } = await sb
    .from("admin_users")
    .insert({ email, name, enabled: true, status: "invited" })
    .select("id,email")
    .maybeSingle();

  if (uErr) return jsonErrorCompat("Erro ao criar usuário.", 500, { code: "db_error", extra: { details: uErr.message } });

  const plain = randomToken();
  const tokenHash = sha256Hex(plain);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await sb.from("admin_auth_tokens").insert({
    user_id: user.id,
    type: "invite",
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: sess.user.id,
  });

  await sb.from("admin_audit_log").insert({ actor_user_id: sess.user.id, action: "invite_user", target_user_id: user.id, meta: { email } });

  const url = `${appUrl()}/admin/activate?token=${encodeURIComponent(plain)}`;
  const text = `Meta-Lav Pagamentos — convite de acesso\n\nAcesse o link para definir sua senha (expira em 24h):\n${url}`;

  // enqueue via outbox (temporary: WhatsApp) — until email channel exists in OpenClaw
  const adminWhatsTarget = String(process.env.ADMIN_WHATSAPP_TARGET || "+5567984020002");
  await sb.from("alert_outbox").insert({
    event_code: "admin_invite",
    severity: "info",
    fingerprint: tokenHash,
    channel: "whatsapp",
    target: adminWhatsTarget,
    text,
    status: "pending",
    attempts: 0,
  });

  return NextResponse.json({ ok: true, user_id: user.id });
}
