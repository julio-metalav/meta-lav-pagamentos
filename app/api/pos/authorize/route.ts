// app/api/pos/authorize/route.ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseAuthorizeInput } from "@/lib/payments/contracts";
import { isPosCanaryAllowed } from "@/lib/payments/rollout";

const NEXUS_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown";

function withCommitHeader(res: NextResponse): NextResponse {
  res.headers.set("x-nexus-commit", NEXUS_COMMIT);
  return res;
}

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

    // x-pos-serial: header obrigatório; fallback no body para compat (CI/proxy pode dropar header)
    const headerPosSerial = String(
      req.headers.get("x-pos-serial") || req.headers.get("X-Pos-Serial")
      || bodyObj.x_pos_serial || bodyObj.pos_serial || ""
    ).trim();
    if (!headerPosSerial) {
      return withCommitHeader(jsonErrorCompat("x-pos-serial é obrigatório.", 400, { code: "missing_pos_serial" }));
    }

    // a) Buscar POS pelo x-pos-serial (cedo para poder derivar condominio_id quando omitido no body)
    const { data: posDevice, error: posErr } = await supabase
      .from("pos_devices")
      .select("id, serial, condominio_id")
      .eq("serial", headerPosSerial)
      .maybeSingle();

    if (posErr) {
      return withCommitHeader(jsonErrorCompat("Erro ao buscar pos_devices.", 500, {
        code: "db_error",
        extra: { details: posErr.message },
      }));
    }

    if (!posDevice) {
      return withCommitHeader(jsonErrorCompat("POS não cadastrado (pos_devices).", 401, { code: "pos_not_found" }));
    }

    // Campos obrigatórios no body; condominio_id pode ser omitido e derivado do POS (útil em dev)
    const identificador_local = String(bodyObj.identificador_local || "").trim();
    const condominio_id = String(
      bodyObj.condominio_id !== undefined && bodyObj.condominio_id !== null && bodyObj.condominio_id !== ""
        ? bodyObj.condominio_id
        : posDevice.condominio_id ?? ""
    ).trim();
    const valor_centavos_raw = bodyObj.valor_centavos;
    const metodo_raw = String(bodyObj.metodo || "").trim().toUpperCase();

    if (!identificador_local) {
      return withCommitHeader(jsonErrorCompat("identificador_local é obrigatório.", 400, { code: "missing_identificador_local" }));
    }
    if (!condominio_id) {
      return withCommitHeader(jsonErrorCompat("condominio_id é obrigatório (ou cadastre o POS em pos_devices com condominio_id).", 400, { code: "missing_condominio_id" }));
    }
    if (!valor_centavos_raw || (typeof valor_centavos_raw !== "number" && typeof valor_centavos_raw !== "string")) {
      return withCommitHeader(jsonErrorCompat("valor_centavos é obrigatório.", 400, { code: "missing_valor_centavos" }));
    }
    if (!metodo_raw || (metodo_raw !== "PIX" && metodo_raw !== "CARTAO")) {
      return withCommitHeader(jsonErrorCompat("metodo é obrigatório (PIX | CARTAO).", 400, { code: "missing_metodo" }));
    }

    const valor_centavos = typeof valor_centavos_raw === "number" ? Math.trunc(valor_centavos_raw) : parseInt(String(valor_centavos_raw), 10);
    if (!Number.isFinite(valor_centavos) || valor_centavos <= 0) {
      return withCommitHeader(jsonErrorCompat("valor_centavos inválido.", 400, { code: "invalid_valor_centavos" }));
    }
    const metodo = metodo_raw as "PIX" | "CARTAO";

    // b) Validar que pos.condominio_id === condominio_id (já garantido se veio do POS)
    if (posDevice.condominio_id !== condominio_id) {
      return withCommitHeader(jsonErrorCompat("POS não pertence a este condomínio.", 403, {
        code: "pos_condominio_mismatch",
        extra: {
          pos_condominio_id: posDevice.condominio_id,
          requested_condominio_id: condominio_id,
        },
      }));
    }

    const rollout = isPosCanaryAllowed(String(condominio_id || ""));
    if (!rollout.allowed) {
      return withCommitHeader(jsonErrorCompat("POS authorize indisponível para este condomínio (canary).", 403, {
        code: "canary_not_allowed",
        extra: {
          condominio_id,
          canary_mode: rollout.mode,
          canary_reason: rollout.reason,
        },
      }));
    }

    // 2) Validação de identificador duplicado (mesmo condominio)
    const { data: identMatches, error: identErr } = await supabase
      .from("condominio_maquinas")
      .select("id,ativa")
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .limit(2);

    if (identErr) {
      return withCommitHeader(jsonErrorCompat("Erro ao validar identificador_local.", 500, {
        code: "db_error",
        extra: { details: identErr.message },
      }));
    }

    const activeMatches = (identMatches || []).filter((row: { ativa: boolean | null }) => !!row?.ativa);
    if (activeMatches.length > 1) {
      return withCommitHeader(jsonErrorCompat("identificador_local duplicado no condomínio.", 409, {
        code: "duplicate_machine_identifier",
        extra: { condominio_id, identificador_local },
      }));
    }

    // c) Buscar máquina com identificador_local, condominio_id, ativa = true
    const { data: maquina, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, gateway_id, ativa, pos_device_id")
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .eq("ativa", true)
      .maybeSingle();

    if (maqErr) {
      return withCommitHeader(jsonErrorCompat("Erro ao buscar condominio_maquinas.", 500, {
        code: "db_error",
        extra: { details: maqErr.message },
      }));
    }

    if (!maquina) {
      return withCommitHeader(jsonErrorCompat("Máquina não encontrada ou inativa.", 404, {
        code: "machine_not_found",
        extra: {
          condominio_id,
          identificador_local,
        },
      }));
    }

    // d) Validar que machine.pos_device_id === pos.id
    if (maquina.pos_device_id !== posDevice.id) {
      return withCommitHeader(jsonErrorCompat("Máquina não está vinculada a este POS.", 403, {
        code: "machine_not_bound_to_pos",
        extra: {
          condominio_id,
          identificador_local,
          machine_pos_device_id: maquina.pos_device_id,
          requested_pos_device_id: posDevice.id,
        },
      }));
    }

    if (!maquina.gateway_id) {
      return withCommitHeader(jsonErrorCompat("Máquina sem gateway_id vinculado.", 409, { code: "missing_gateway_id" }));
    }

    // Parse quote se existir (mantém compatibilidade)
    const quote = bodyObj.quote && typeof bodyObj.quote === "object" ? (bodyObj.quote as Record<string, unknown>) : null;
    if (quote) {
      const validUntilMs = Date.parse(String(quote.valid_until || ""));
      if (!Number.isFinite(validUntilMs)) {
        return withCommitHeader(jsonErrorCompat("quote invalid", 400, { code: "invalid_quote" }));
      }
      if (validUntilMs < Date.now()) {
        return withCommitHeader(jsonErrorCompat("quote expired", 410, { code: "expired", retry_after_sec: 0 }));
      }
      if (!String(quote.pricing_hash || "").startsWith("sha256:")) {
        return withCommitHeader(jsonErrorCompat("quote integrity invalid", 400, { code: "invalid_quote_hash" }));
      }
    }

    // Idempotência (anti retry/duplo clique)
    const minuteBucket = Math.floor(Date.now() / 60000);
    const idempotency_key =
      (bodyObj.idempotency_key ? String(bodyObj.idempotency_key).trim() : null) ||
      `pos:${headerPosSerial}:${identificador_local}:${valor_centavos}:${metodo}:${minuteBucket}`;

    const { data: existingPay, error: existErr } = await supabase
      .from("pagamentos")
      .select("id, status, created_at")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existErr) {
      return withCommitHeader(jsonErrorCompat("Erro ao verificar idempotency_key.", 500, {
        code: "db_error",
        extra: { details: existErr.message },
      }));
    }

    if (existingPay) {
      return withCommitHeader(NextResponse.json({
        ok: true,
        reused: true,
        correlation_id,
        pagamento_id: existingPay.id,
        pagamento_status: existingPay.status,
      }));
    }

    // Pagamento (PT-BR) — sem ciclo/comando nesta etapa. status explícito para fake-gateway-confirm e manual/confirm.
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
        status: "CRIADO",
      })
      .select("id, status, created_at")
      .single();

    if (payErr) {
      return withCommitHeader(jsonErrorCompat("Erro ao criar pagamento.", 500, {
        code: "db_error",
        extra: { details: payErr.message },
      }));
    }

    return withCommitHeader(NextResponse.json({
      ok: true,
      reused: false,
      correlation_id,
      pagamento_id: pagamento.id,
      pagamento_status: pagamento.status,
    }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return withCommitHeader(jsonErrorCompat("Erro inesperado no authorize.", 500, {
      code: "internal_error",
      extra: { details: msg },
    }));
  }
}
