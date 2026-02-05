// app/api/pos/authorize/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Meta-Lav Pagamentos — POS Authorize (PT-BR schema)
 * Regra B: 1 POS por máquina (condominio_maquinas.pos_device_id = pos_devices.id)
 *
 * Fonte da verdade: tabelas PT-BR:
 * - pos_devices, condominio_maquinas, pagamentos, ciclos, iot_commands
 *
 * Objetivo: POS -> cria pagamento + ciclo -> cria iot_command(PULSE) pro gateway.
 *
 * Importante:
 * - Usa Supabase ADMIN (service role) via lib/supabaseAdmin.ts (server only).
 * - Sem dependência de tipos gerados do Supabase.
 * - Sem rpc("sql") / information_schema.
 */

type AuthorizeBody = {
  pos_serial?: string;
  identificador_local?: string; // ex: LAV-01 / SEC-01
  valor_centavos?: number;      // preferível
  valor?: number;               // opcional (reais) -> converte
  metodo?: "PIX" | "CARTAO";    // pag_metodo
  idempotency_key?: string;     // ideal vir do POS
  metadata?: Record<string, unknown>;
};

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

function toCentavos(body: AuthorizeBody): number | null {
  if (typeof body.valor_centavos === "number" && Number.isFinite(body.valor_centavos)) {
    const v = Math.trunc(body.valor_centavos);
    return v > 0 ? v : null;
  }
  if (typeof body.valor === "number" && Number.isFinite(body.valor)) {
    const v = Math.round(body.valor * 100);
    return v > 0 ? v : null;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin() as any;

    let body: AuthorizeBody = {};
    try {
      body = (await req.json()) as AuthorizeBody;
    } catch {
      body = {};
    }

    const headerPosSerial =
      req.headers.get("x-pos-serial") ||
      req.headers.get("x-device-serial") ||
      req.headers.get("x-serial") ||
      "";

    const headerIdempotency =
      req.headers.get("x-idempotency-key") ||
      req.headers.get("idempotency-key") ||
      "";

    const pos_serial = (body.pos_serial || headerPosSerial).trim();
    const identificador_local = (body.identificador_local || "").trim();

    const valor_centavos = toCentavos(body);
    const metodo = (body.metodo || "").trim().toUpperCase();
    const metadata = body.metadata ?? {};

    if (!pos_serial) return jsonError("POS serial ausente (body.pos_serial ou header x-pos-serial).", 400);
    if (!identificador_local) return jsonError("identificador_local ausente (ex.: LAV-01 / SEC-01).", 400);
    if (!valor_centavos) return jsonError("valor inválido (use valor_centavos ou valor).", 400);
    if (metodo !== "PIX" && metodo !== "CARTAO") return jsonError("metodo inválido (PIX | CARTAO).", 400);

    // 1) POS Device
    const { data: posDevice, error: posErr } = await supabase
      .from("pos_devices")
      .select("id, serial, condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr) return jsonError("Erro ao buscar pos_devices.", 500, { details: posErr.message });
    if (!posDevice) return jsonError("POS não cadastrado (pos_devices).", 401);

    const condominio_id = posDevice.condominio_id;

    // 2) Máquina vinculada ao POS (Regra B)
    const { data: maquina, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, gateway_id, tipo, identificador_local, ativa, pos_device_id")
      .eq("condominio_id", condominio_id)
      .eq("pos_device_id", posDevice.id)
      .eq("identificador_local", identificador_local)
      .maybeSingle();

    if (maqErr) return jsonError("Erro ao buscar condominio_maquinas.", 500, { details: maqErr.message });
    if (!maquina) {
      return jsonError("Máquina não encontrada ou não vinculada a este POS (pos_device_id).", 404, {
        condominio_id,
        pos_device_id: posDevice.id,
        identificador_local,
      });
    }
    if (!maquina.ativa) return jsonError("Máquina está inativa.", 409);
    if (!maquina.gateway_id) return jsonError("Máquina sem gateway_id vinculado.", 409);

    // 3) Idempotência (anti retry/duplo clique)
    const minuteBucket = Math.floor(Date.now() / 60000);
    const idempotency_key =
      (body.idempotency_key || headerIdempotency || "").trim() ||
      `pos:${pos_serial}:${identificador_local}:${valor_centavos}:${metodo}:${minuteBucket}`;

    const { data: existingPay, error: existErr } = await supabase
      .from("pagamentos")
      .select("id, status, created_at")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existErr) return jsonError("Erro ao verificar idempotency_key.", 500, { details: existErr.message });

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
        metodo: metodo,
        gateway_pagamento: "STONE",
        valor_centavos,
        idempotency_key,
        external_id: null,
        // status default: CRIADO
      })
      .select("id, status, created_at")
      .single();

    if (payErr) return jsonError("Erro ao criar pagamento.", 500, { details: payErr.message });

    // 5) Ciclo (PT-BR)
    const { data: ciclo, error: cicloErr } = await supabase
      .from("ciclos")
      .insert({
        pagamento_id: pagamento.id,
        condominio_id,
        maquina_id: maquina.id,
        // status default: AGUARDANDO_LIBERACAO
      })
      .select("id, status, created_at")
      .single();

    if (cicloErr) {
      return jsonError("Pagamento criado, mas falhou ao criar ciclo.", 500, {
        pagamento_id: pagamento.id,
        details: cicloErr.message,
      });
    }

    // 6) Comando IoT (PT-BR)
    const cmd_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

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
          tipo_maquina: maquina.tipo, // lavadora | secadora
          metadata,
        },
        status: "PENDENTE",
        expires_at,
      })
      .select("id, status, created_at")
      .single();

    if (cmdErr) {
      return jsonError("Pagamento+ciclo criados, mas falhou ao criar iot_command.", 500, {
        pagamento_id: pagamento.id,
        ciclo_id: ciclo.id,
        details: cmdErr.message,
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
    return jsonError("Erro inesperado no authorize.", 500, { details: e?.message ?? String(e) });
  }
}
