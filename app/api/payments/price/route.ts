export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parsePriceInput } from "@/lib/payments/contracts";

/** GET: preço oficial vigente para POS (condominio_precos, canal POS). Query: condominio_id, identificador_local */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const condominio_id = String(u.searchParams.get("condominio_id") ?? "").trim();
    const identificador_local = String(u.searchParams.get("identificador_local") ?? "").trim();

    if (!condominio_id) {
      return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });
    }
    if (!identificador_local) {
      return jsonErrorCompat("identificador_local é obrigatório.", 400, { code: "missing_identificador_local" });
    }

    const sb = supabaseAdmin() as any;

    const { data: maquina, error: maqErr } = await sb
      .from("condominio_maquinas")
      .select("id, condominio_id, identificador_local")
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .eq("ativa", true)
      .maybeSingle();

    if (maqErr) {
      return jsonErrorCompat("Erro ao buscar máquina.", 500, {
        code: "db_error",
        extra: { details: maqErr.message },
      });
    }
    if (!maquina) {
      return jsonErrorCompat("Máquina não encontrada ou inativa.", 404, {
        code: "machine_not_found",
        extra: { condominio_id, identificador_local },
      });
    }

    const nowIso = new Date().toISOString();
    const { data: precoRow, error: precoErr } = await sb
      .from("condominio_precos")
      .select("valor_centavos, vigente_a_partir")
      .eq("condominio_maquina_id", maquina.id)
      .eq("canal", "POS")
      .lte("vigente_a_partir", nowIso)
      .order("vigente_a_partir", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (precoErr) {
      return jsonErrorCompat("Erro ao resolver preço.", 500, {
        code: "db_error",
        extra: { details: precoErr.message },
      });
    }
    if (!precoRow) {
      return jsonErrorCompat("Preço não configurado para esta máquina (canal POS).", 409, {
        code: "price_not_configured",
        extra: { condominio_maquina_id: maquina.id },
      });
    }

    return NextResponse.json({
      ok: true,
      condominio_id: maquina.condominio_id,
      identificador_local: maquina.identificador_local,
      condominio_maquina_id: maquina.id,
      valor_centavos: Number(precoRow.valor_centavos),
      vigente_a_partir: precoRow.vigente_a_partir ?? null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao consultar preço.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}

function pickAmountCents(row: Record<string, any>): number | null {
  const centsCandidates = ["valor_centavos", "preco_centavos", "amount_centavos"];
  for (const k of centsCandidates) {
    const v = row?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  }

  const brlCandidates = ["valor", "preco", "amount"];
  for (const k of brlCandidates) {
    const v = row?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v * 100);
  }

  return null;
}

function rowMatchesService(row: Record<string, any>, serviceType: "lavadora" | "secadora") {
  const candidates = [row?.tipo, row?.tipo_maquina, row?.service_type, row?.categoria];
  const normalized = candidates.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return true; // fallback permissivo
  return normalized.includes(serviceType);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parsePriceInput(body);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const sb = supabaseAdmin() as any;

    const { data: machine, error: mErr } = await sb
      .from("condominio_maquinas")
      .select("id, condominio_id, tipo, ativa")
      .eq("id", input.condominio_maquinas_id)
      .eq("condominio_id", input.condominio_id)
      .maybeSingle();

    if (mErr) return jsonErrorCompat("Erro ao consultar máquina.", 500, { code: "db_error", extra: { details: mErr.message } });
    if (!machine || !machine.ativa) return jsonErrorCompat("machine not found", 404, { code: "machine_not_found" });

    const nowIso = new Date().toISOString();

    const { data: rows, error: pErr } = await sb
      .from("precos_ciclo")
      .select("*")
      .eq("maquina_id", machine.id)
      .or(`vigente_ate.is.null,vigente_ate.gte.${nowIso}`)
      .lte("vigente_desde", nowIso)
      .limit(100);

    if (pErr) return jsonErrorCompat("Erro ao consultar precos_ciclo.", 500, { code: "db_error", extra: { details: pErr.message } });

    const list = (rows ?? []) as Record<string, any>[];
    const filtered = list.filter((r) => rowMatchesService(r, input.service_type));

    const chosen = filtered.find((r) => pickAmountCents(r) !== null) ?? list.find((r) => pickAmountCents(r) !== null);
    if (!chosen) {
      return jsonErrorCompat("price not found", 404, { code: "price_not_found" });
    }

    const amountCentavos = pickAmountCents(chosen);
    if (!amountCentavos) {
      return jsonErrorCompat("invalid price", 500, { code: "invalid_price" });
    }

    const now = Date.now();
    const validUntil = new Date(now + 5 * 60 * 1000).toISOString();
    const quoteId = crypto.randomUUID();

    const pricing_hash = `sha256:${crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          quoteId,
          condominio_id: input.condominio_id,
          condominio_maquinas_id: input.condominio_maquinas_id,
          service_type: input.service_type,
          amountCentavos,
          rule_id: chosen.id ?? null,
          validUntil,
        })
      )
      .digest("hex")}`;

    return NextResponse.json({
      ok: true,
      quote: {
        quote_id: quoteId,
        amount: amountCentavos / 100,
        currency: "BRL",
        source: "precos_ciclo",
        rule_id: chosen.id ? `preco:${chosen.id}` : "preco:unknown",
        valid_until: validUntil,
        pricing_hash,
      },
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado no price.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
