export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

function normalizeIdentificador(v: string): string {
  return String(v ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.maquinas.read");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const u = new URL(req.url);
    const condominio_id = String(u.searchParams.get("condominio_id") || "").trim();

    const sb = supabaseAdmin() as any;
    let q = sb
      .from("condominio_maquinas")
      .select("id,condominio_id,identificador_local,tipo,gateway_id,pos_device_id,ativa,updated_at")
      .eq("tenant_id", tenantId)
      .order("identificador_local", { ascending: true })
      .limit(300);

    if (condominio_id) q = q.eq("condominio_id", condominio_id);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar máquinas.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.maquinas.write");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const body = await req.json().catch(() => ({}));
    const condominio_id = String(body?.condominio_id || "").trim();
    const identificador_local = normalizeIdentificador(String(body?.identificador_local ?? ""));
    const tipo = String(body?.tipo || "").trim().toLowerCase();
    const gateway_id = String(body?.gateway_id || "").trim();
    const pos_device_id = String(body?.pos_device_id || "").trim();

    if (!condominio_id) return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });
    if (!identificador_local) return jsonErrorCompat("identificador_local é obrigatório.", 400, { code: "missing_identificador_local" });
    if (tipo !== "lavadora" && tipo !== "secadora") return jsonErrorCompat("tipo inválido.", 400, { code: "invalid_tipo" });
    if (!gateway_id) return jsonErrorCompat("gateway_id é obrigatório.", 400, { code: "missing_gateway_id" });
    if (!pos_device_id) return jsonErrorCompat("pos_device_id é obrigatório.", 400, { code: "missing_pos_device_id" });

    const sb = supabaseAdmin() as any;

    const { data: cond, error: condErr } = await sb
      .from("condominios")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", condominio_id)
      .maybeSingle();
    if (condErr) return jsonErrorCompat("Erro ao validar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!cond) return jsonErrorCompat("Condomínio não encontrado.", 404, { code: "condominio_not_found" });

    const { data: gw, error: gwErr } = await sb
      .from("gateways")
      .select("id, condominio_id")
      .eq("tenant_id", tenantId)
      .eq("id", gateway_id)
      .maybeSingle();
    if (gwErr) return jsonErrorCompat("Erro ao validar gateway.", 500, { code: "db_error", extra: { details: gwErr.message } });
    if (!gw) return jsonErrorCompat("Gateway não encontrado.", 404, { code: "gateway_not_found" });
    if (gw.condominio_id !== condominio_id) return jsonErrorCompat("Gateway não pertence ao condomínio informado.", 400, { code: "gateway_wrong_condominio" });

    const { data: pos, error: posErr } = await sb
      .from("pos_devices")
      .select("id, condominio_id")
      .eq("tenant_id", tenantId)
      .eq("id", pos_device_id)
      .maybeSingle();
    if (posErr) return jsonErrorCompat("Erro ao validar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!pos) return jsonErrorCompat("POS não encontrado.", 404, { code: "pos_not_found" });
    if (pos.condominio_id !== condominio_id) return jsonErrorCompat("POS não pertence ao condomínio informado.", 400, { code: "pos_wrong_condominio" });

    const { data: dupLocal, error: dupLocalErr } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .maybeSingle();

    if (dupLocalErr) return jsonErrorCompat("Erro ao validar identificador_local.", 500, { code: "db_error", extra: { details: dupLocalErr.message } });
    if (dupLocal) return jsonErrorCompat("identificador_local já existe no condomínio.", 409, { code: "duplicate_identificador_local" });

    const { data: created, error: createErr } = await sb
      .from("condominio_maquinas")
      .insert({
        tenant_id: tenantId,
        condominio_id,
        identificador_local,
        tipo,
        gateway_id,
        pos_device_id,
        ativa: true,
      })
      .select("id,condominio_id,identificador_local,tipo,gateway_id,pos_device_id,ativa,updated_at")
      .single();

    if (createErr) return jsonErrorCompat("Erro ao criar máquina.", 500, { code: "db_error", extra: { details: createErr.message } });

    return NextResponse.json({ ok: true, item: created }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao criar máquina.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
