export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: condominioId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const condominioMaquinaId = String(body?.condominio_maquina_id ?? "").trim();
    const canal = String(body?.canal ?? "").trim().toUpperCase();

    if (!condominioMaquinaId) return jsonErrorCompat("condominio_maquina_id é obrigatório.", 400, { code: "missing_condominio_maquina_id" });
    if (canal !== "POS" && canal !== "APP") return jsonErrorCompat("canal deve ser POS ou APP.", 400, { code: "invalid_canal" });

    const sb = supabaseAdmin() as any;

    const { data: maquina, error: maqErr } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("id", condominioMaquinaId)
      .eq("condominio_id", condominioId)
      .maybeSingle();
    if (maqErr) return jsonErrorCompat("Erro ao validar máquina.", 500, { code: "db_error", extra: { details: maqErr.message } });
    if (!maquina) return jsonErrorCompat("Máquina não encontrada ou não pertence ao condomínio.", 404, { code: "maquina_not_found" });

    const nowIso = new Date().toISOString();
    const { error: delErr } = await sb
      .from("condominio_precos")
      .delete()
      .eq("condominio_maquina_id", condominioMaquinaId)
      .eq("canal", canal)
      .gt("vigente_a_partir", nowIso);

    if (delErr) return jsonErrorCompat("Erro ao remover preço futuro.", 500, { code: "db_error", extra: { details: delErr.message } });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao remover preço futuro.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
