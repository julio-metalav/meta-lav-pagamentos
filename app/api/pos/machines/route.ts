export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const condominio_id = String(u.searchParams.get("condominio_id") || "").trim();
    const pos_serial = String(u.searchParams.get("pos_serial") || "").trim();

    if (!condominio_id) return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });

    const sb = supabaseAdmin() as any;

    let posDeviceId: string | null = null;
    if (pos_serial) {
      const { data: pos, error: posErr } = await sb
        .from("pos_devices")
        .select("id,condominio_id")
        .eq("serial", pos_serial)
        .eq("condominio_id", condominio_id)
        .maybeSingle();

      if (posErr) return jsonErrorCompat("Erro ao buscar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
      if (pos) posDeviceId = pos.id;
    }

    let q = sb
      .from("condominio_maquinas")
      .select("id,identificador_local,tipo,ativa,pos_device_id,condominio_id")
      .eq("condominio_id", condominio_id)
      .eq("ativa", true)
      .order("identificador_local", { ascending: true });

    if (posDeviceId) q = q.eq("pos_device_id", posDeviceId);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao listar máquinas POS.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
