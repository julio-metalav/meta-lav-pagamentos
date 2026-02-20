export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getAdminSession } from "@/lib/admin/server";

const CREATED_BY_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: condominioId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const condominioMaquinaId = String(body?.condominio_maquina_id ?? "").trim();
    const canal = String(body?.canal ?? "").trim().toUpperCase();
    const valorCentavos = typeof body?.valor_centavos === "number" ? body.valor_centavos : Number(body?.valor_centavos);

    if (!condominioMaquinaId) return jsonErrorCompat("condominio_maquina_id é obrigatório.", 400, { code: "missing_condominio_maquina_id" });
    if (canal !== "POS" && canal !== "APP") return jsonErrorCompat("canal deve ser POS ou APP.", 400, { code: "invalid_canal" });
    if (!Number.isInteger(valorCentavos) || valorCentavos < 0) return jsonErrorCompat("valor_centavos deve ser inteiro >= 0.", 400, { code: "invalid_valor_centavos" });

    const sb = supabaseAdmin() as any;

    const { data: maquina, error: maqErr } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("id", condominioMaquinaId)
      .eq("condominio_id", condominioId)
      .maybeSingle();
    if (maqErr) return jsonErrorCompat("Erro ao validar máquina.", 500, { code: "db_error", extra: { details: maqErr.message } });
    if (!maquina) return jsonErrorCompat("Máquina não encontrada ou não pertence ao condomínio.", 404, { code: "maquina_not_found" });

    const sess = await getAdminSession();
    const createdBy = sess?.user_id ?? CREATED_BY_PLACEHOLDER;
    const vigenteAPartir = new Date().toISOString();

    const { data: inserted, error: insertErr } = await sb
      .from("condominio_precos")
      .insert({
        condominio_maquina_id: condominioMaquinaId,
        canal,
        valor_centavos: valorCentavos,
        vigente_a_partir: vigenteAPartir,
        created_by: createdBy,
      })
      .select("id,condominio_maquina_id,canal,valor_centavos,vigente_a_partir")
      .single();

    if (insertErr) return jsonErrorCompat("Erro ao criar preço.", 500, { code: "db_error", extra: { details: insertErr.message } });

    return NextResponse.json({ ok: true, item: inserted });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao definir preço vigente.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
