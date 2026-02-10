// app/api/pos/authorize/route.ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseAuthorizeInput } from "@/lib/payments/contracts";
import { isPosCanaryAllowed } from "@/lib/payments/rollout";

/**
 * Meta-Lav Pagamentos — POS Authorize
 *
 * Regra financeira/operacional:
 * - authorize: apenas autoriza/cria pagamento
 * - confirm: confirma pagamento
 * - execute-cycle: cria ciclo + comando IoT (liberação física)
 */
export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin() as any;

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const correlation_id = String(
      req.headers.get("x-correlation-id") || bodyObj.correlation_id || bodyObj.request_id || crypto.randomUUID()
    ).trim();

    const parsed = parseAuthorizeInput(req, bodyObj);
    if (!parsed.ok) {
      return jsonErrorCompat(parsed.message, 400, { code: parsed.code });
    }

    const input = parsed.data;
    const { pos_serial, identificador_local, valor_centavos, metodo, quote } = input;

    if (quote) {
      const validUntilMs = Date.parse(quote.valid_until);
      if (!Number.isFinite(validUntilMs)) {
        return jsonErrorCompat("quote invalid", 400, { code: "invalid_quote" });
      }
      if (validUntilMs < Date.now()) {
        return jsonErrorCompat("quote expired", 410, { code: "expired", retry_after_sec: 0 });
      }
      if (!String(quote.pricing_hash || "").startsWith("sha256:")) {
        return jsonErrorCompat("quote integrity invalid", 400, { code: "invalid_quote_hash" });
      }
    }

    // 1) POS Device
    const { data: posDevice, error: posErr } = await supabase
      .from("pos_devices")
      .select("id, serial, condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr) return jsonErrorCompat("Erro ao buscar pos_devices.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!posDevice) return jsonErrorCompat("POS não cadastrado (pos_devices).", 401, { code: "pos_not_found" });

    const condominio_id = posDevice.condominio_id;

    const rollout = isPosCanaryAllowed(String(condominio_id || ""));
    if (!rollout.allowed) {
      return jsonErrorCompat("POS authorize indisponível para este condomínio (canary).", 403, {
        code: "canary_not_allowed",
        extra: {
          condominio_id,
          canary_mode: rollout.mode,
          canary_reason: rollout.reason,
        },
      });
    }

    // 2) Máquina vinculada ao POS
    const { data: maquina, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, gateway_id, tipo, identificador_local, ativa, pos_device_id")
      .eq("condominio_id", condominio_id)
      .eq("pos_device_id", posDevice.id)
      .eq("identificador_local", identificador_local)
      .maybeSingle();

    if (maqErr) return jsonErrorCompat("Erro ao buscar condominio_maquinas.", 500, { code: "db_error", extra: { details: maqErr.message } });
    if (!maquina) {
      return jsonErrorCompat("Máquina não encontrada ou não vinculada a este POS (pos_device_id).", 404, {
        code: "machine_not_found",
        extra: {
          condominio_id,
          pos_device_id: posDevice.id,
          identificador_local,
        },
      });
    }
    if (!maquina.ativa) return jsonErrorCompat("Máquina está inativa.", 409, { code: "machine_inactive" });
    if (!maquina.gateway_id) return jsonErrorCompat("Máquina sem gateway_id vinculado.", 409, { code: "missing_gateway_id" });

    // 3) Idempotência (anti retry/duplo clique)
    const minuteBucket = Math.floor(Date.now() / 60000);
    const idempotency_key =
      input.idempotency_key ||
      `pos:${pos_serial}:${identificador_local}:${valor_centavos}:${metodo}:${minuteBucket}`;

    const { data: existingPay, error: existErr } = await supabase
      .from("pagamentos")
      .select("id, status, created_at")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existErr) return jsonErrorCompat("Erro ao verificar idempotency_key.", 500, { code: "db_error", extra: { details: existErr.message } });

    if (existingPay) {
      return NextResponse.json({
        ok: true,
        reused: true,
        correlation_id,
        pagamento_id: existingPay.id,
        pagamento_status: existingPay.status,
      });
    }

    // 4) Pagamento (PT-BR) — sem ciclo/comando nesta etapa
    const { data: pagamento, error: payErr } = await supabase
      .from("pagamentos")
      .insert({
        condominio_id,
        maquina_id: maquina.id,
        origem: "POS",
        metodo,
        gateway_pagamento: "STONE",
        valor_centavos,
        idempotency_key,
        external_id: null,
      })
      .select("id, status, created_at")
      .single();

    if (payErr) return jsonErrorCompat("Erro ao criar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });

    return NextResponse.json({
      ok: true,
      reused: false,
      correlation_id,
      pagamento_id: pagamento.id,
      pagamento_status: pagamento.status,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no authorize.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
