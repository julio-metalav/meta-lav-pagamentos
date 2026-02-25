export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parsePriceInput } from "@/lib/payments/contracts";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { resolvePriceOrThrow, PriceResolutionError } from "@/lib/payments/pricing/resolvePrice";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parsePriceInput(body);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin();

    const resolved = await resolvePriceOrThrow({
      tenantId,
      condominioId: input.condominio_id,
      condominioMaquinasId: input.condominio_maquinas_id,
      serviceType: input.service_type,
      supabaseClient: sb,
    });

    const amountCentavos = resolved.amountCentavos;
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
          rule_id: resolved.ruleId,
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
        rule_id: resolved.ruleId ? `preco:${resolved.ruleId}` : "preco:unknown",
        valid_until: validUntil,
        pricing_hash,
      },
    });
  } catch (e) {
    if (e instanceof PriceResolutionError) {
      const status = e.code === "machine_not_found" || e.code === "price_not_found" ? 404 : 500;
      return jsonErrorCompat(e.message, status, {
        code: e.code,
        extra: e.details ? { details: e.details } : undefined,
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no price.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
