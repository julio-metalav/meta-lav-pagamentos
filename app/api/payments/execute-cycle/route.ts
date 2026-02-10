export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseExecuteCycleInput } from "@/lib/payments/contracts";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parseExecuteCycleInput(body);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const sb = supabaseAdmin() as any;

    const { data: pay, error: payErr } = await sb
      .from("pagamentos")
      .select("id,status,condominio_id")
      .eq("id", input.payment_id)
      .maybeSingle();

    if (payErr) return jsonErrorCompat("Erro ao buscar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });
    if (!pay) return jsonErrorCompat("payment not found", 404, { code: "payment_not_found" });

    if (String(pay.status || "").toUpperCase() !== "PAGO") {
      return jsonErrorCompat("payment not confirmed", 409, { code: "payment_not_confirmed" });
    }

    const { data: machine, error: mErr } = await sb
      .from("condominio_maquinas")
      .select("id,gateway_id,identificador_local,tipo,condominio_id,ativa")
      .eq("id", input.condominio_maquinas_id)
      .eq("condominio_id", pay.condominio_id)
      .maybeSingle();

    if (mErr) return jsonErrorCompat("Erro ao consultar máquina.", 500, { code: "db_error", extra: { details: mErr.message } });
    if (!machine || !machine.ativa) return jsonErrorCompat("machine not found", 404, { code: "machine_not_found" });
    if (!machine.gateway_id) return jsonErrorCompat("missing gateway", 409, { code: "missing_gateway_id" });

    const { data: existingCycle, error: exCycleErr } = await sb
      .from("ciclos")
      .select("id,status")
      .eq("pagamento_id", input.payment_id)
      .eq("maquina_id", machine.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exCycleErr) return jsonErrorCompat("Erro ao verificar ciclo existente.", 500, { code: "db_error", extra: { details: exCycleErr.message } });

    // Cria ciclo, se não houver
    let cycleId = existingCycle?.id ?? null;
    if (!cycleId) {
      const { data: newCycle, error: cErr } = await sb
        .from("ciclos")
        .insert({
          pagamento_id: input.payment_id,
          condominio_id: pay.condominio_id,
          maquina_id: machine.id,
          status: "AGUARDANDO_LIBERACAO",
        })
        .select("id,status")
        .single();

      if (cErr || !newCycle) {
        return jsonErrorCompat("Erro ao criar ciclo.", 500, { code: "cycle_create_failed", extra: { details: cErr?.message } });
      }
      cycleId = newCycle.id;
    }

    // Idempotência final: com ciclo resolvido, reaproveita comando já criado para key+ciclo.
    const { data: existingCmdByCycle, error: exCmdCycleErr } = await sb
      .from("iot_commands")
      .select("id,cmd_id,payload,created_at")
      .eq("gateway_id", machine.gateway_id)
      .filter("payload->>execute_idempotency_key", "eq", input.idempotency_key)
      .filter("payload->>ciclo_id", "eq", String(cycleId))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exCmdCycleErr) {
      return jsonErrorCompat("Erro ao verificar idempotência de comando.", 500, {
        code: "db_error",
        extra: { details: exCmdCycleErr.message },
      });
    }

    if (existingCmdByCycle) {
      return NextResponse.json({
        ok: true,
        cycle_id: cycleId,
        command_id: existingCmdByCycle.cmd_id,
        status: "queued",
        replay: true,
      });
    }

    const cmd_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: cmdErr } = await sb.from("iot_commands").insert({
      gateway_id: machine.gateway_id,
      condominio_maquinas_id: machine.id,
      cmd_id,
      tipo: "PULSE",
      payload: {
        pulses: 1,
        ciclo_id: cycleId,
        pagamento_id: input.payment_id,
        execute_idempotency_key: input.idempotency_key,
        identificador_local: machine.identificador_local,
        tipo_maquina: machine.tipo,
        channel: input.channel,
        origin: input.origin,
      },
      status: "pendente",
      expires_at,
    });

    if (cmdErr) {
      return jsonErrorCompat("Erro ao criar comando iot.", 500, {
        code: "iot_command_create_failed",
        extra: { details: cmdErr.message, cycle_id: cycleId },
      });
    }

    return NextResponse.json({
      ok: true,
      cycle_id: cycleId,
      command_id: cmd_id,
      status: "queued",
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado no execute-cycle.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
