export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseConfirmInput } from "@/lib/payments/contracts";
import { getTenantIdFromRequest } from "@/lib/tenant";

function providerToGateway(provider: "stone" | "asaas"): "STONE" | "ASAAS" {
  return provider === "stone" ? "STONE" : "ASAAS";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const correlation_id = String(
      req.headers.get("x-correlation-id") || bodyObj.correlation_id || bodyObj.request_id || crypto.randomUUID()
    ).trim();

    const parsed = parseConfirmInput(bodyObj);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    const gateway = providerToGateway(input.provider);
    const targetStatus = input.result === "approved" ? "PAGO" : "FALHOU";

    // Dedupe forte por provider+provider_ref
    const { data: replayByRef, error: refErr } = await sb
      .from("pagamentos")
      .select("id,status,external_id,gateway_pagamento,paid_at")
      .eq("tenant_id", tenantId)
      .eq("gateway_pagamento", gateway)
      .eq("external_id", input.provider_ref)
      .maybeSingle();

    if (refErr) return jsonErrorCompat("Erro ao verificar provider_ref.", 500, { code: "db_error", extra: { details: refErr.message } });

    if (replayByRef) {
      return NextResponse.json({
        ok: true,
        replay: true,
        correlation_id,
        payment_id: replayByRef.id,
        status: replayByRef.status,
      });
    }

    const { data: pay, error: payErr } = await sb
      .from("pagamentos")
      .select("id,status,gateway_pagamento,external_id,paid_at")
      .eq("tenant_id", tenantId)
      .eq("id", input.payment_id)
      .maybeSingle();

    if (payErr) return jsonErrorCompat("Erro ao buscar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });
    if (!pay) return jsonErrorCompat("payment not found", 404, { code: "payment_not_found" });

    // Se já tiver external_id igual, replay idempotente
    if (pay.external_id && String(pay.external_id) === input.provider_ref) {
      return NextResponse.json({
        ok: true,
        replay: true,
        correlation_id,
        payment_id: pay.id,
        status: pay.status,
      });
    }

    // Se já finalizado, evita regressão de estado
    if (["PAGO", "ESTORNADO", "CANCELADO"].includes(String(pay.status || "").toUpperCase())) {
      return NextResponse.json({
        ok: true,
        replay: true,
        correlation_id,
        payment_id: pay.id,
        status: pay.status,
      });
    }

    const patch: Record<string, unknown> = {
      status: targetStatus,
      external_id: input.provider_ref,
      gateway_pagamento: gateway,
    };

    if (targetStatus === "PAGO") patch.paid_at = new Date().toISOString();

    const { data: updated, error: upErr } = await sb
      .from("pagamentos")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", input.payment_id)
      .select("id,status")
      .maybeSingle();

    if (upErr) return jsonErrorCompat("Erro ao confirmar pagamento.", 500, { code: "db_error", extra: { details: upErr.message } });
    if (!updated) return jsonErrorCompat("payment not found for update", 404, { code: "payment_not_found" });

    return NextResponse.json({
      ok: true,
      correlation_id,
      payment_id: updated.id,
      status: String(updated.status || "").toLowerCase() === "pago" ? "confirmed" : "failed",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no confirm.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
