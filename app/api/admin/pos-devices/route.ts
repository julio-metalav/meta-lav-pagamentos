export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

function normSerial(v: unknown) {
  return String(v ?? "").trim().toUpperCase();
}

function normText(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);

    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.pos_devices.read");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const u = new URL(req.url);
    const condominio_id = normText(u.searchParams.get("condominio_id"));
    const search = normText(u.searchParams.get("search"));

    const sb = supabaseAdmin() as any;

    let q = sb
      .from("pos_devices")
      .select("id,serial,condominio_id,updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (condominio_id) q = q.eq("condominio_id", condominio_id);
    if (search) q = q.ilike("serial", `%${search}%`);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar POS devices.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar POS devices.", 500, { code: "internal_error", extra: { details: msg } });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);

    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.pos_devices.write");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const serial = normSerial(body?.serial);
    const condominio_id = normText(body?.condominio_id);

    if (!serial) return jsonErrorCompat("serial é obrigatório.", 400, { code: "missing_serial" });
    if (!condominio_id) return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });

    const sb = supabaseAdmin() as any;

    // valida vínculo: condominio existe no mesmo tenant
    const { data: cond, error: condErr } = await sb
      .from("condominios")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", condominio_id)
      .maybeSingle();

    if (condErr) return jsonErrorCompat("Erro ao validar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!cond) return jsonErrorCompat("condominio_id inválido.", 400, { code: "invalid_condominio_id" });

    // dedupe por serial no tenant
    const { data: dup, error: dupErr } = await sb
      .from("pos_devices")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("serial", serial)
      .maybeSingle();

    if (dupErr) return jsonErrorCompat("Erro ao validar POS serial.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("POS já existe com este serial.", 409, { code: "duplicate_pos_serial" });

    const { data, error } = await sb
      .from("pos_devices")
      .insert({ tenant_id: tenantId, serial, condominio_id })
      .select("id,serial,condominio_id,updated_at")
      .single();

    if (error) return jsonErrorCompat("Erro ao criar POS device.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao criar POS device.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
