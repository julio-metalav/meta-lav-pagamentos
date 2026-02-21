export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parsePriceInput } from "@/lib/payments/contracts";
import { getTenantIdFromRequest } from "@/lib/tenant";

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
    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    const { data: machine, error: mErr } = await sb
      .from("condominio_maquinas")
      .select("id, condominio_id, tipo, ativa")
      .eq("tenant_id", tenantId)
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
