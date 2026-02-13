export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getAppUser } from "@/lib/app/auth";

export async function POST(req: Request) {
  try {
    const sb = supabaseAdmin() as any;

    // Auth do App
    const auth = await getAppUser(req, sb);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const appUser = auth.user; // { id, telefone, ... }

    // Parse
    const body = await req.json().catch(() => ({}));
    const valor_centavos = Number(body?.valor_centavos || 0) | 0;
    const identificador_local = String(body?.identificador_local || "").trim();
    const condominio_maquinas_id = String(body?.condominio_maquinas_id || "").trim();

    if (!valor_centavos || valor_centavos <= 0) return jsonErrorCompat("invalid_amount", 400, { code: "invalid_amount" });
    if (!identificador_local && !condominio_maquinas_id)
      return jsonErrorCompat("missing machine selector", 400, { code: "missing_machine" });

    // Resolve máquina
    let machine: any = null;
    if (condominio_maquinas_id) {
      const { data, error } = await sb
        .from("condominio_maquinas")
        .select("id,gateway_id,identificador_local,tipo,condominio_id,ativa")
        .eq("id", condominio_maquinas_id)
        .maybeSingle();
      if (error) return jsonErrorCompat("db_error", 500, { code: "db_error", extra: { details: error.message } });
      machine = data;
    } else {
      const { data, error } = await sb
        .from("condominio_maquinas")
        .select("id,gateway_id,identificador_local,tipo,condominio_id,ativa")
        .eq("identificador_local", identificador_local)
        .eq("ativa", true)
        .limit(1)
        .maybeSingle();
      if (error) return jsonErrorCompat("db_error", 500, { code: "db_error", extra: { details: error.message } });
      machine = data;
    }

    if (!machine) return jsonErrorCompat("machine not found", 404, { code: "machine_not_found" });
    if (!machine.ativa) return jsonErrorCompat("machine inactive", 409, { code: "machine_inactive" });
    if (!machine.gateway_id) return jsonErrorCompat("missing gateway", 409, { code: "missing_gateway_id" });

    // Cria pagamento
    const { data: pagamento, error: payErr } = await sb
      .from("pagamentos")
      .insert({
        condominio_id: machine.condominio_id,
        maquina_id: machine.id,
        origem: "APP",
        metodo: "PIX", // mínimo viável; front pode escolher depois
        gateway_pagamento: "STONE",
        valor_centavos,
        idempotency_key: `app:${appUser.id}:${machine.id}:${valor_centavos}:${Math.floor(Date.now()/60000)}`,
        external_id: null,
      })
      .select("id, status, created_at")
      .single();

    if (payErr) return jsonErrorCompat("Erro ao criar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });

    // Cria ciclo
    const { data: ciclo, error: cicloErr } = await sb
      .from("ciclos")
      .insert({
        pagamento_id: pagamento.id,
        condominio_id: machine.condominio_id,
        maquina_id: machine.id,
        status: "AGUARDANDO_LIBERACAO",
      })
      .select("id,status,created_at")
      .single();

    if (cicloErr) {
      return jsonErrorCompat("Pagamento criado, mas falhou ao criar ciclo.", 500, {
        code: "cycle_create_failed",
        extra: { pagamento_id: pagamento.id, details: cicloErr.message },
      });
    }

    // Comando IoT
    const cmd_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: cmdErr } = await sb
      .from("iot_commands")
      .insert({
        gateway_id: machine.gateway_id,
        condominio_maquinas_id: machine.id,
        cmd_id,
        tipo: "PULSE",
        payload: {
          pulses: 1,
          ciclo_id: ciclo.id,
          pagamento_id: pagamento.id,
          identificador_local: machine.identificador_local,
          tipo_maquina: machine.tipo,
          channel: "app",
          origin: { user_id: appUser.id, pos_device_id: null },
        },
        status: "pendente",
        expires_at,
      });

    if (cmdErr) {
      return jsonErrorCompat("Pagamento+ciclo criados, mas falhou ao criar iot_command.", 500, {
        code: "iot_command_create_failed",
        extra: { pagamento_id: pagamento.id, ciclo_id: ciclo.id, details: cmdErr.message },
      });
    }

    return NextResponse.json({ ok: true, pagamento_id: pagamento.id, ciclo_id: ciclo.id, cmd_id, gateway_id: machine.gateway_id, expires_at });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado no app authorize.", 500, { code: "internal_error", extra: { details: e?.message ?? String(e) } });
  }
}
