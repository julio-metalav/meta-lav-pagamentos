// app/api/pos/authorize/route.ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseAuthorizeInput } from "@/lib/payments/contracts";

/**
 * Meta-Lav Pagamentos — POS Authorize (piloto Fase A)
 *
 * Objetivo deste passo:
 * - Introduzir DTO/validação centralizada (contracts)
 * - Introduzir erro canônico compatível (error_v1 sem quebrar legado)
 *
 * Sem mudança funcional no fluxo atual.
 */
export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin() as any;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = parseAuthorizeInput(req, body);
    if (!parsed.ok) {
      return jsonErrorCompat(parsed.message, 400, { code: parsed.code });
    }

    const input = parsed.data;
    const { pos_serial, identificador_local, valor_centavos, metodo, metadata } = input;

    // 1) POS Device
    const { data: posDevice, error: posErr } = await supabase
      .from("pos_devices")
      .select("id, serial, condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr) return jsonErrorCompat("Erro ao buscar pos_devices.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!posDevice) return jsonErrorCompat("POS não cadastrado (pos_devices).", 401, { code: "pos_not_found" });

    const condominio_id = posDevice.condominio_id;

    // 2) Máquina vinculada ao POS (Regra B)
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
        pagamento_id: existingPay.id,
        pagamento_status: existingPay.status,
      });
    }

    // 4) Pagamento (PT-BR)
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

    // 5) Ciclo (PT-BR)
    const { data: ciclo, error: cicloErr } = await supabase
      .from("ciclos")
      .insert({
        pagamento_id: pagamento.id,
        condominio_id,
        maquina_id: maquina.id,
      })
      .select("id, status, created_at")
      .single();

    if (cicloErr) {
      return jsonErrorCompat("Pagamento criado, mas falhou ao criar ciclo.", 500, {
        code: "cycle_create_failed",
        extra: {
          pagamento_id: pagamento.id,
          details: cicloErr.message,
        },
      });
    }

    // 6) Comando IoT (PT-BR)
    const cmd_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: iotCmd, error: cmdErr } = await supabase
      .from("iot_commands")
      .insert({
        gateway_id: maquina.gateway_id,
        condominio_maquinas_id: maquina.id,
        cmd_id,
        tipo: "PULSE",
        payload: {
          pulses: 1,
          ciclo_id: ciclo.id,
          pagamento_id: pagamento.id,
          identificador_local: maquina.identificador_local,
          tipo_maquina: maquina.tipo,
          metadata,
          channel: input.channel,
          origin: input.origin,
        },
        status: "PENDENTE",
        expires_at,
      })
      .select("id, status, created_at")
      .single();

    if (cmdErr) {
      return jsonErrorCompat("Pagamento+ciclo criados, mas falhou ao criar iot_command.", 500, {
        code: "iot_command_create_failed",
        extra: {
          pagamento_id: pagamento.id,
          ciclo_id: ciclo.id,
          details: cmdErr.message,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      reused: false,
      pagamento_id: pagamento.id,
      ciclo_id: ciclo.id,
      iot_command_row_id: iotCmd.id,
      cmd_id,
      gateway_id: maquina.gateway_id,
      expires_at,
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado no authorize.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
