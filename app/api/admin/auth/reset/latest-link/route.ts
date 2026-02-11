export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

function extractLink(text: string) {
  const m = String(text || "").match(/https?:\/\/\S+/);
  return m?.[0] || null;
}

export async function GET() {
  const sess = await requireAdminSession();
  if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });

  const ok = await requirePermission(sess.user.id, "admin.users.read");
  if (!ok) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

  const sb = supabaseAdmin() as any;
  const { data, error } = await sb
    .from("alert_outbox")
    .select("id,event_code,channel,target,text,status,created_at,sent_at")
    .eq("event_code", "admin_reset")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return jsonErrorCompat("Erro ao buscar último reset.", 500, { code: "db_error", extra: { details: error.message } });
  }

  if (!data) {
    return NextResponse.json({ ok: true, item: null });
  }

  const link = extractLink(String(data.text || ""));

  return NextResponse.json({
    ok: true,
    item: {
      id: data.id,
      channel: data.channel,
      target: data.target,
      status: data.status,
      created_at: data.created_at,
      sent_at: data.sent_at,
      link,
    },
  });
}
