export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { jsonErrorCompat } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { POST as executeCyclePost } from "@/app/api/payments/execute-cycle/route";

function normalizeMetodo(raw: unknown): string {
  const value = String(raw ?? "STONE_OFFLINE").trim().toUpperCase();
  if (!value) return "STONE_OFFLINE";
  return value;
}

function gatewayFromMetodo(metodo: string): string {
  if (metodo.includes("PIX")) return "PIX";
  if (metodo.includes("CARD") || metodo.includes("CART")) return "STONE";
  if (metodo.includes("STONE")) return "STONE";
  return "MANUAL";
}

function parseValorToCentavos(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const normalized = str.replace(/,/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const [integers, decimals = ""] = normalized.split(".");
  const paddedDecimals = decimals.padEnd(2, "0");
  const centavosStr = `${integers}${paddedDecimals}`;
  if (!/^\d+$/.test(centavosStr)) return null;
  const centavos = Number(centavosStr);
  if (!Number.isFinite(centavos) || centavos <= 0) return null;
  return centavos;
}

export async function POST(req: Request) {
  const manualToken = process.env.INTERNAL_MANUAL_TOKEN || "";
  if (!manualToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_confirm_disabled",
        error_v1: { code: "manual_confirm_disabled", message: "INTERNAL_MANUAL_TOKEN ausente no runtime" },
      },
      { status: 501 }
    );
  }

  const provided = (req.headers.get("x-internal-token") || "").trim();
  if (!provided || provided !== manualToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        error_v1: { code: "invalid_manual_token", message: "x-internal-token inválido" },
      },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const correlation_id = String(
      req.headers.get("x-correlation-id") || body.correlation_id || body.request_id || crypto.randomUUID()
    ).trim();

    const pos_serial = String(body.pos_serial ?? "").trim();
    const condominio_maquinas_id = String(body.condominio_maquinas_id ?? "").trim();
    const valor_centavos_from_string = parseValorToCentavos(body.valor);
    const valor_centavos_raw =
      valor_centavos_from_string !== null ? valor_centavos_from_string : Number(body.valor_centavos ?? 0);
    const metodo = normalizeMetodo(body.metodo);
    const identificador_local = body.identificador_local ? String(body.identificador_local).trim() : null;
    const ref_externa = body.ref_externa ? String(body.ref_externa).trim() : "";

    if (!pos_serial) return jsonErrorCompat("pos_serial é obrigatório", 400, { code: "missing_pos_serial" });
    if (!condominio_maquinas_id)
      return jsonErrorCompat("condominio_maquinas_id é obrigatório", 400, { code: "missing_condominio_maquinas_id" });
    if (!Number.isFinite(valor_centavos_raw) || valor_centavos_raw <= 0)
      return jsonErrorCompat("valor/valor_centavos inválido", 400, { code: "invalid_amount" });

    const valor_centavos = Math.trunc(valor_centavos_raw);

    const sb = supabaseAdmin() as any;

    const { data: posDevice, error: posErr } = await sb
      .from("pos_devices")
      .select("id,serial,condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr)
      return jsonErrorCompat("Erro ao buscar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!posDevice) return jsonErrorCompat("POS não cadastrado.", 401, { code: "pos_not_found" });

    const { data: machine, error: machineErr } = await sb
      .from("condominio_maquinas")
      .select("id,condominio_id,gateway_id,identificador_local,ativa")
      .eq("id", condominio_maquinas_id)
      .eq("condominio_id", posDevice.condominio_id)
      .maybeSingle();

    if (machineErr)
      return jsonErrorCompat("Erro ao buscar máquina.", 500, { code: "db_error", extra: { details: machineErr.message } });
    if (!machine)
      return jsonErrorCompat("Máquina não encontrada ou não pertence ao POS.", 404, { code: "machine_not_found" });
    if (!machine.ativa) return jsonErrorCompat("Máquina inativa.", 409, { code: "machine_inactive" });
    if (!machine.gateway_id) return jsonErrorCompat("Máquina sem gateway vinculado.", 409, { code: "missing_gateway_id" });
    if (identificador_local && machine.identificador_local !== identificador_local) {
      return jsonErrorCompat("identificador_local não confere com a máquina", 409, {
        code: "identificador_local_mismatch",
        extra: { esperado: machine.identificador_local, recebido: identificador_local },
      });
    }

    const manualIdempotencyKey = ref_externa
      ? `manual:${pos_serial}:${ref_externa}:${valor_centavos}`
      : null;

    let pagamentoId: string | null = null;

    if (manualIdempotencyKey) {
      const { data: existingManual, error: manualErr } = await sb
        .from("pagamentos")
        .select("id,status")
        .eq("idempotency_key", manualIdempotencyKey)
        .maybeSingle();
      if (manualErr)
        return jsonErrorCompat("Erro ao verificar idempotência manual.", 500, {
          code: "db_error",
          extra: { details: manualErr.message },
        });
      if (existingManual?.id) pagamentoId = existingManual.id;
    }

    if (!pagamentoId && ref_externa) {
      const { data: existingByRef, error: refErr } = await sb
        .from("pagamentos")
        .select("id,status")
        .eq("external_id", ref_externa)
        .maybeSingle();
      if (refErr)
        return jsonErrorCompat("Erro ao verificar ref_externa.", 500, {
          code: "db_error",
          extra: { details: refErr.message },
        });
      if (existingByRef?.id) pagamentoId = existingByRef.id;
    }

    const paidAtIso = new Date().toISOString();

    if (!pagamentoId) {
      const insertPayload: Record<string, unknown> = {
        condominio_id: machine.condominio_id,
        maquina_id: machine.id,
        origem: "POS",
        metodo,
        gateway_pagamento: "STONE",
        valor_centavos,
        status: "PAGO",
        paid_at: paidAtIso,
        idempotency_key: manualIdempotencyKey,
        external_id: ref_externa || null,
      };

      const { data: createdPay, error: createErr } = await sb
        .from("pagamentos")
        .insert(insertPayload)
        .select("id,status")
        .single();

      if (createErr || !createdPay) {
        return jsonErrorCompat("Erro ao criar pagamento manual.", 500, {
          code: "manual_payment_create_failed",
          extra: { details: createErr?.message },
        });
      }

      pagamentoId = createdPay.id;
    } else {
      const { error: ensurePaidErr } = await sb
        .from("pagamentos")
        .update({ status: "PAGO", paid_at: paidAtIso })
        .eq("id", pagamentoId)
        .in("status", ["PENDENTE", "pendente", "pending", "autorizado", "AUTORIZADO"]);

      if (ensurePaidErr) {
        return jsonErrorCompat("Erro ao confirmar pagamento manual.", 500, {
          code: "manual_payment_update_failed",
          extra: { details: ensurePaidErr.message },
        });
      }
    }

    const execIdempotencyKey = ref_externa
      ? `manual-exec:${ref_externa}:${condominio_maquinas_id}`
      : `manual-exec:${pagamentoId}`;

    const execRequest = new Request("http://internal/api/payments/execute-cycle", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-correlation-id": correlation_id,
      }),
      body: JSON.stringify({
        payment_id: pagamentoId,
        condominio_maquinas_id,
        idempotency_key: execIdempotencyKey,
        channel: "pos",
        origin: { pos_device_id: posDevice.id ?? null, user_id: null },
      }),
    });

    const execResponse = await executeCyclePost(execRequest);
    const execPayload = await execResponse.json();
    if (!execResponse.ok) {
      return NextResponse.json(execPayload, { status: execResponse.status });
    }

    return NextResponse.json({
      ok: true,
      correlation_id,
      pagamento_id: pagamentoId,
      pagamento_status: "PAGO",
      cycle_id: String(execPayload.cycle_id || ""),
      command_id: String(execPayload.command_id || ""),
      status: execPayload.status || "queued",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no manual/confirm.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
