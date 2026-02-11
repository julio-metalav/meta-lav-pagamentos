export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { randomToken, sha256Hex } from "@/lib/admin/auth";

function appUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "").startsWith("http")
    ? String(process.env.NEXT_PUBLIC_APP_URL || "")
    : `https://${process.env.VERCEL_URL}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();

  if (!email) return jsonErrorCompat("email é obrigatório", 400, { code: "validation_error" });

  const sb = supabaseAdmin() as any;
  const { data: user } = await sb.from("admin_users").select("id,email,enabled,status").eq("email", email).maybeSingle();

  // Do not leak user existence.
  if (!user || !user.enabled) return NextResponse.json({ ok: true });

  const plain = randomToken();
  const tokenHash = sha256Hex(plain);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await sb.from("admin_auth_tokens").insert({ user_id: user.id, type: "reset", token_hash: tokenHash, expires_at: expiresAt });

  const url = `${appUrl()}/admin/reset?token=${encodeURIComponent(plain)}`;
  const text = `Meta-Lav Pagamentos — reset de senha\n\nAcesse o link para criar uma nova senha (expira em 30 min):\n${url}`;

  // enqueue via outbox (temporary: WhatsApp) — until email channel exists in OpenClaw
  const adminWhatsTarget = String(process.env.ADMIN_WHATSAPP_TARGET || "+5567984020002");
  await sb.from("alert_outbox").insert({
    event_code: "admin_reset",
    severity: "info",
    fingerprint: tokenHash,
    channel: "whatsapp",
    target: adminWhatsTarget,
    text,
    status: "pending",
    attempts: 0,
  });

  return NextResponse.json({ ok: true });
}
