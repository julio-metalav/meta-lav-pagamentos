export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const condominio_id = String(u.searchParams.get("condominio_id") || "").trim();

    const sb = supabaseAdmin() as any;
    let q = sb
      .from("condominio_maquinas")
      .select("id,condominio_id,identificador_local,tipo,gateway_id,pos_device_id,ativa,updated_at")
      .order("identificador_local", { ascending: true })
      .limit(300);

    if (condominio_id) q = q.eq("condominio_id", condominio_id);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao listar máquinas.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const condominio_id = String(body?.condominio_id || "").trim();
    const identificador_local = String(body?.identificador_local || "").trim();
    const tipo = String(body?.tipo || "").trim().toLowerCase();
    const gateway_id = String(body?.gateway_id || "").trim();
    const pos_device_id = String(body?.pos_device_id || "").trim();

    if (!condominio_id) return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });
    if (!identificador_local) return jsonErrorCompat("identificador_local é obrigatório.", 400, { code: "missing_identificador_local" });
    if (tipo !== "lavadora" && tipo !== "secadora") return jsonErrorCompat("tipo inválido.", 400, { code: "invalid_tipo" });
    if (!gateway_id) return jsonErrorCompat("gateway_id é obrigatório.", 400, { code: "missing_gateway_id" });
    if (!pos_device_id) return jsonErrorCompat("pos_device_id é obrigatório.", 400, { code: "missing_pos_device_id" });

    const sb = supabaseAdmin() as any;

    const { data: dupLocal, error: dupLocalErr } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .maybeSingle();

    if (dupLocalErr) return jsonErrorCompat("Erro ao validar identificador_local.", 500, { code: "db_error", extra: { details: dupLocalErr.message } });
    if (dupLocal) return jsonErrorCompat("identificador_local já existe no condomínio.", 409, { code: "duplicate_identificador_local" });

    const { data: dupGateway, error: dupGwErr } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("gateway_id", gateway_id)
      .eq("ativa", true)
      .maybeSingle();

    if (dupGwErr) return jsonErrorCompat("Erro ao validar gateway 1:1.", 500, { code: "db_error", extra: { details: dupGwErr.message } });
    if (dupGateway) return jsonErrorCompat("gateway já vinculado a outra máquina ativa.", 409, { code: "gateway_already_bound" });

    const { data: created, error: createErr } = await sb
      .from("condominio_maquinas")
      .insert({
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
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao criar máquina.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
