export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: condominioId } = await ctx.params;
    const sb = supabaseAdmin() as any;

    const { data: condominio, error: condErr } = await sb
      .from("condominios")
      .select("id")
      .eq("id", condominioId)
      .maybeSingle();
    if (condErr) return jsonErrorCompat("Erro ao buscar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!condominio) return jsonErrorCompat("Condomínio não encontrado.", 404, { code: "condominio_not_found" });

    const { data: maquinas, error: maqErr } = await sb
      .from("condominio_maquinas")
      .select("id,tipo,identificador_local")
      .eq("condominio_id", condominioId)
      .order("identificador_local", { ascending: true });
    if (maqErr) return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: maqErr.message } });
    if (!maquinas?.length) {
      return NextResponse.json({
        ok: true,
        condominio_id: condominioId,
        maquinas: [],
      });
    }

    const maquinaIds = maquinas.map((m: { id: string }) => m.id);
    const { data: precos, error: precosErr } = await sb
      .from("condominio_precos")
      .select("id,condominio_maquina_id,canal,valor_centavos,vigente_a_partir")
      .in("condominio_maquina_id", maquinaIds)
      .order("vigente_a_partir", { ascending: false });
    if (precosErr) return jsonErrorCompat("Erro ao listar preços.", 500, { code: "db_error", extra: { details: precosErr.message } });

    const now = new Date().toISOString();
    const precosByMaquina = new Map<string, { vigente: Map<string, { valor_centavos: number; vigente_a_partir: string }>; futuro: Map<string, { valor_centavos: number; vigente_a_partir: string } | null> }>();

    for (const m of maquinas) {
      precosByMaquina.set(m.id, {
        vigente: new Map(),
        futuro: new Map([["POS", null], ["APP", null]]),
      });
    }

    for (const p of precos ?? []) {
      const key = p.condominio_maquina_id;
      const entry = precosByMaquina.get(key);
      if (!entry) continue;
      const canal = String(p.canal);
      const vigenteAPartir = String(p.vigente_a_partir ?? "");
      const valor = Number(p.valor_centavos);
      const row = { valor_centavos: valor, vigente_a_partir: vigenteAPartir };
      if (vigenteAPartir <= now) {
        if (!entry.vigente.has(canal)) entry.vigente.set(canal, row);
      } else {
        if (entry.futuro.get(canal) === null) entry.futuro.set(canal, row);
      }
    }

    const maquinasOut = maquinas.map((m: { id: string; tipo: string; identificador_local: string }) => {
      const entry = precosByMaquina.get(m.id)!;
      const precosCanal: Record<string, { vigente: { valor_centavos: number; vigente_a_partir: string } | null; futuro: { valor_centavos: number; vigente_a_partir: string } | null }> = {};
      for (const canal of ["POS", "APP"]) {
        precosCanal[canal] = {
          vigente: entry.vigente.get(canal) ?? null,
          futuro: entry.futuro.get(canal) ?? null,
        };
      }
      return {
        id: m.id,
        tipo: m.tipo,
        identificador_local: m.identificador_local,
        precos_por_canal: precosCanal,
      };
    });

    return NextResponse.json({
      ok: true,
      condominio_id: condominioId,
      maquinas: maquinasOut,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar precificação.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
