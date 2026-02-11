export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sess = await requireAdminSession();
  if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });

  const ok = await requirePermission(sess.user.id, "admin.users.write");
  if (!ok) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const allowed = Array.isArray(body?.allowed) ? body.allowed.map((x: any) => String(x)) : [];

  const sb = supabaseAdmin() as any;

  const { data: perms, error: pErr } = await sb.from("admin_permissions").select("id,code");
  if (pErr) return jsonErrorCompat("Erro ao ler permissões.", 500, { code: "db_error", extra: { details: pErr.message } });

  const byCode = new Map<string, string>();
  for (const p of perms || []) byCode.set(String(p.code), String(p.id));

  // Reset overrides: delete existing, insert allowed overrides.
  await sb.from("admin_user_permissions").delete().eq("user_id", id);

  const rows = allowed
    .filter((c: string) => byCode.has(c))
    .map((c: string) => ({ user_id: id, permission_id: byCode.get(c), allowed: true }));

  if (rows.length) {
    const { error: insErr } = await sb.from("admin_user_permissions").insert(rows);
    if (insErr) return jsonErrorCompat("Erro ao salvar permissões.", 500, { code: "db_error", extra: { details: insErr.message } });
  }

  await sb.from("admin_audit_log").insert({ actor_user_id: sess.user.id, action: "set_user_permissions", target_user_id: id, meta: { allowed } });

  return NextResponse.json({ ok: true });
}
