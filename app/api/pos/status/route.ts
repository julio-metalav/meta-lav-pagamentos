export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";

 type PaymentRow = {
  id: string;
  status: string | null;
  valor_centavos: number | null;
  metodo: string | null;
  created_at: string;
  expires_at?: string | null;
};

 type CycleRow = {
  id: string;
  status: string | null;
  maquina_id: string | null;
  condominio_id: string | null;
  created_at: string;
};

 type CommandRow = {
  id: string;
  cmd_id: string | null;
  status: string | null;
  created_at: string;
  expires_at?: string | null;
  payload: Record<string, unknown> | null;
};

function parseUiState(payment: PaymentRow, cycle?: CycleRow | null, command?: CommandRow | null) {
  const paymentStatus = String(payment?.status || "").toUpperCase();
  const cycleStatus = String(cycle?.status || "").toUpperCase();

  if (!paymentStatus) return "ERRO";

  if (paymentStatus === "CRIADO") return "AGUARDANDO_PAGAMENTO";
  if (paymentStatus !== "PAGO") {
    if (paymentStatus === "EXPIRADO") return "EXPIRADO";
    return "ERRO";
  }

  if (!cycle) return "PAGO";

  if (cycleStatus === "AGUARDANDO_LIBERACAO" || cycleStatus === "LIBERADO") return "LIBERANDO";
  if (cycleStatus === "EM_USO") return "EM_USO";
  if (cycleStatus === "FINALIZADO") return "FINALIZADO";

  return "ERRO";
}

/** Prioridade para escolher o "ciclo atual" do pagamento: preferir o que mais progrediu (evita mostrar órfão AGUARDANDO_LIBERACAO). */
function cycleStatusPriority(s: string | null): number {
  const u = String(s ?? "").toUpperCase();
  if (u === "FINALIZADO") return 4;
  if (u === "EM_USO") return 3;
  if (u === "LIBERADO") return 2;
  if (u === "AGUARDANDO_LIBERACAO") return 1;
  return 0;
}

/** Dado vários ciclos do mesmo pagamento (já ordenados por created_at desc), retorna o de maior prioridade de status. */
function pickBestCycleByStatus<T extends { status: string | null; created_at?: string | null }>(rows: T[]): T | null {
  if (!rows?.length) return null;
  let best = rows[0];
  let bestPri = cycleStatusPriority(best.status);
  for (let i = 1; i < rows.length; i++) {
    const p = cycleStatusPriority(rows[i].status);
    if (p > bestPri) {
      best = rows[i];
      bestPri = p;
    }
  }
  return best;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pagamentoId = String(url.searchParams.get("pagamento_id") || "").trim();
    if (!pagamentoId) return jsonErrorCompat("pagamento_id é obrigatório.", 400, { code: "missing_pagamento_id" });

    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    const { data: payment, error: payErr } = await sb
      .from("pagamentos")
      .select("id,status,valor_centavos,metodo,created_at")
      .eq("tenant_id", tenantId)
      .eq("id", pagamentoId)
      .maybeSingle();

    if (payErr) return jsonErrorCompat("Erro ao buscar pagamento.", 500, { code: "db_error", extra: { details: payErr.message } });
    if (!payment) return jsonErrorCompat("Pagamento não encontrado.", 404, { code: "payment_not_found" });

    const { data: cycleRows, error: cycleErr } = await sb
      .from("ciclos")
      .select("id,status,maquina_id,condominio_id,created_at")
      .eq("tenant_id", tenantId)
      .eq("pagamento_id", pagamentoId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (cycleErr) {
      return jsonErrorCompat("Erro ao buscar ciclo.", 500, { code: "db_error", extra: { details: cycleErr.message } });
    }

    const cycle = pickBestCycleByStatus((cycleRows ?? []) as CycleRow[]);

    let command: CommandRow | null = null;
    try {
      const commandQuery = sb
        .from("iot_commands")
        .select("id,cmd_id,status,created_at,payload")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (cycle?.id) {
        commandQuery.filter("payload->>ciclo_id", "eq", String(cycle.id));
      } else {
        commandQuery.filter("payload->>pagamento_id", "eq", pagamentoId);
      }

      const { data: commandData, error: commandErr } = await commandQuery.maybeSingle();
      if (commandErr) {
        return jsonErrorCompat("Erro ao buscar comando IoT.", 500, { code: "db_error", extra: { details: commandErr.message } });
      }
      command = commandData || null;
    } catch (_err) {
      command = null;
    }

    const uiState = parseUiState(payment as PaymentRow, cycle as CycleRow, command);

    return NextResponse.json({
      ok: true,
      pagamento: {
        id: payment.id,
        status: payment.status,
        valor_centavos: payment.valor_centavos,
        metodo: payment.metodo,
        created_at: payment.created_at,
        expires_at: null,
      },
      ciclo: cycle
        ? {
            id: cycle.id,
            status: cycle.status,
            condominio_maquinas_id: cycle.maquina_id,
            condominio_id: cycle.condominio_id,
          }
        : null,
      iot_command: command
        ? {
            id: command.id,
            cmd_id: command.cmd_id,
            status: command.status,
            created_at: command.created_at,
            expires_at: null,
            correlation_id: (command.payload as Record<string, unknown> | null)?.correlation_id || null,
          }
        : null,
      ui_state: uiState,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado ao consultar status do POS.", 500, {
      code: "internal_error",
      extra: { details: message },
    });
  }
}
