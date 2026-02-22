export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseExecuteCycleInput } from "@/lib/payments/contracts";
import { getTenantIdFromRequest } from "@/lib/tenant";

const PENDING_TTL_SEC = Number(process.env.PAYMENTS_PENDING_TTL_SEC || 300);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const correlation_id = String(
      req.headers.get("x-correlation-id") || bodyObj.correlation_id || bodyObj.request_id || crypto.randomUUID()
    ).trim();

    const parsed = parseExecuteCycleInput(bodyObj);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    const { data: pay, error: payErr } = await sb
      .from("pagamentos")
      .select("id,status,condominio_id")
      .eq("tenant_id", tenantId)
      .eq("id", input.payment_id)
      .maybeSingle();

    if (payErr) return jsonErrorCompat("Erro ao buscar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });
    if (!pay) return jsonErrorCompat("payment not found", 404, { code: "payment_not_found" });

    const { data: existingCycle, error: exCycleErr } = await sb
      .from("ciclos")
      .select("id,status,created_at")
      .eq("tenant_id", tenantId)
      .eq("pagamento_id", input.payment_id)
      .eq("maquina_id", input.condominio_maquinas_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exCycleErr) return jsonErrorCompat("Erro ao verificar ciclo existente.", 500, { code: "db_error", extra: { details: exCycleErr.message } });

    if (existingCycle?.status === "AGUARDANDO_LIBERACAO") {
      const createdAtMs = existingCycle.created_at ? new Date(existingCycle.created_at).getTime() : Date.now();
      if (Date.now() >= createdAtMs + PENDING_TTL_SEC * 1000) {
        await sb.from("ciclos").update({ status: "ABORTADO" }).eq("tenant_id", tenantId).eq("id", existingCycle.id).eq("status", "AGUARDANDO_LIBERACAO");
        return jsonErrorCompat("cycle expired", 409, { code: "cycle_expired", retry_after_sec: 0 });
      }
    }

    const { data: rpcResult, error: rpcErr } = await sb.rpc("rpc_confirm_and_enqueue", {
      p_payment_id: input.payment_id,
      p_tenant_id: tenantId,
      p_condominio_maquinas_id: input.condominio_maquinas_id,
      p_idempotency_key: input.idempotency_key,
      p_channel: input.channel,
      p_origin: input.origin ?? {},
    });

    if (rpcErr) {
      return jsonErrorCompat("Erro ao confirmar e enfileirar.", 500, { code: "db_error", extra: { details: rpcErr.message } });
    }

    const res = rpcResult as { ok?: boolean; error?: string; payment_id?: string; ciclo_id?: string; command_id?: string; already_processed?: boolean } | null;
    if (!res || res.ok === false) {
      const code = res?.error === "payment_not_confirmed" ? "payment_not_confirmed" : res?.error === "machine_not_found" ? "machine_not_found" : "rpc_failed";
      return jsonErrorCompat(res?.error ?? "rpc_failed", res?.error === "payment_not_confirmed" ? 409 : res?.error === "machine_not_found" ? 404 : 500, { code });
    }

    return NextResponse.json({
      ok: true,
      replay: !!res.already_processed,
      correlation_id,
      cycle_id: res.ciclo_id,
      command_id: res.command_id,
      status: "queued",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no execute-cycle.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
