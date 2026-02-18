export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const condominio_id = String(url.searchParams.get("condominio_id") || "").trim();

    // Header obrigatório: x-pos-serial
    const pos_serial = String(req.headers.get("x-pos-serial") || "").trim();

    if (!condominio_id) {
      return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });
    }

    if (!pos_serial) {
      return jsonErrorCompat("x-pos-serial é obrigatório.", 400, { code: "missing_pos_serial" });
    }

    const sb = supabaseAdmin() as any;

    // Buscar POS pelo x-pos-serial
    const { data: pos, error: posErr } = await sb
      .from("pos_devices")
      .select("id,condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr) {
      return jsonErrorCompat("Erro ao buscar POS.", 500, {
        code: "db_error",
        extra: { details: posErr.message },
      });
    }

    // Se não existir → retornar 401
    if (!pos) {
      return jsonErrorCompat("POS não cadastrado.", 401, { code: "pos_not_found" });
    }

    // Se existir mas pos.condominio_id !== condominio_id → retornar 403
    if (pos.condominio_id !== condominio_id) {
      return jsonErrorCompat("POS não pertence a este condomínio.", 403, {
        code: "pos_condominio_mismatch",
        extra: {
          pos_condominio_id: pos.condominio_id,
          requested_condominio_id: condominio_id,
        },
      });
    }

    // Se válido → retornar somente máquinas onde:
    // - condominio_maquinas.pos_device_id = pos.id
    // - ativa = true
    const { data: machines, error: machinesErr } = await sb
      .from("condominio_maquinas")
      .select("id,identificador_local,tipo,ativa,pos_device_id,condominio_id")
      .eq("pos_device_id", pos.id)
      .eq("ativa", true)
      .order("identificador_local", { ascending: true });

    if (machinesErr) {
      return jsonErrorCompat("Erro ao listar máquinas.", 500, {
        code: "db_error",
        extra: { details: machinesErr.message },
      });
    }

    return NextResponse.json({
      ok: true,
      items: machines || [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar máquinas POS.", 500, {
      code: "internal_error",
      extra: { details: message },
    });
  }
}
