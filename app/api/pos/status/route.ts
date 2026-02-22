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
  pagamento_id?: string | null;
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

type MachineRow = {
  id: string;
  identificador_local: string | null;
  condominio_id: string | null;
};

function parseUiState(payment: PaymentRow | null, cycle?: CycleRow | null, command?: CommandRow | null): string {
  if (!payment) {
    return cycle ? (String(cycle.status || "").toUpperCase() === "FINALIZADO" ? "LIVRE" : "EM_USO") : "LIVRE";
  }
  const paymentStatus = String(payment.status || "").toUpperCase();
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

/** availability: LIVRE se sem ciclo ou FINALIZADO; EM_USO caso contrário; fail-safe EM_USO. */
function availabilityFromCycle(cycle: CycleRow | null): "LIVRE" | "EM_USO" {
  if (!cycle) return "LIVRE";
  const u = String(cycle.status || "").toUpperCase();
  if (u === "FINALIZADO") return "LIVRE";
  if (u === "EM_USO" || u === "LIBERADO" || u === "AGUARDANDO_LIBERACAO") return "EM_USO";
  return "EM_USO"; // fail-safe
}

function cycleStatusPriority(s: string | null): number {
  const u = String(s ?? "").toUpperCase();
  if (u === "FINALIZADO") return 4;
  if (u === "EM_USO") return 3;
  if (u === "LIBERADO") return 2;
  if (u === "AGUARDANDO_LIBERACAO") return 1;
  return 0;
}

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

function buildResponse(payload: {
  payment: PaymentRow | null;
  cycle: CycleRow | null;
  command: CommandRow | null;
  machine: MachineRow | null;
  availability: "LIVRE" | "EM_USO";
}) {
  const { payment, cycle, command, machine, availability } = payload;
  const uiState = parseUiState(payment, cycle, command);

  return NextResponse.json({
    ok: true,
    availability,
    blocked_until: null as string | null,
    blocked_reason: null as string | null,
    machine: machine
      ? {
          id: machine.id,
          identificador_local: machine.identificador_local,
          condominio_id: machine.condominio_id,
        }
      : null,
    pagamento: payment
      ? {
          id: payment.id,
          status: payment.status,
          valor_centavos: payment.valor_centavos,
          metodo: payment.metodo,
          created_at: payment.created_at,
          expires_at: payment.expires_at ?? null,
        }
      : null,
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
          expires_at: command.expires_at ?? null,
          correlation_id: (command.payload as Record<string, unknown> | null)?.correlation_id || null,
        }
      : null,
    ui_state: uiState,
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pagamentoId = String(url.searchParams.get("pagamento_id") || "").trim();
    const identificadorLocal = String(url.searchParams.get("identificador_local") || "").trim();

    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    if (pagamentoId) {
      // ——— Modo por pagamento_id (compatível) ———
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
        .select("id,status,maquina_id,condominio_id,pagamento_id,created_at")
        .eq("tenant_id", tenantId)
        .eq("pagamento_id", pagamentoId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (cycleErr) {
        return jsonErrorCompat("Erro ao buscar ciclo.", 500, { code: "db_error", extra: { details: cycleErr.message } });
      }

      const cycle = pickBestCycleByStatus((cycleRows ?? []) as CycleRow[]);
      let command: CommandRow | null = null;
      let machine: MachineRow | null = null;

      if (cycle?.id) {
        const { data: cmdData } = await sb
          .from("iot_commands")
          .select("id,cmd_id,status,created_at,expires_at,payload")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .filter("payload->>ciclo_id", "eq", String(cycle.id))
          .maybeSingle();
        command = cmdData || null;
        if (!command && cycle.pagamento_id) {
          const { data: cmdByPay } = await sb
            .from("iot_commands")
            .select("id,cmd_id,status,created_at,expires_at,payload")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(1)
            .filter("payload->>pagamento_id", "eq", String(cycle.pagamento_id))
            .maybeSingle();
          command = cmdByPay || null;
        }
        if (cycle.maquina_id) {
          const { data: m } = await sb
            .from("condominio_maquinas")
            .select("id,identificador_local,condominio_id")
            .eq("tenant_id", tenantId)
            .eq("id", cycle.maquina_id)
            .maybeSingle();
          machine = m || null;
        }
      } else {
        const { data: cmdData } = await sb
          .from("iot_commands")
          .select("id,cmd_id,status,created_at,expires_at,payload")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .filter("payload->>pagamento_id", "eq", pagamentoId)
          .maybeSingle();
        command = cmdData || null;
      }

      const availability = availabilityFromCycle(cycle);
      return buildResponse({
        payment: payment as PaymentRow,
        cycle: cycle as CycleRow,
        command,
        machine,
        availability,
      });
    }

    if (identificadorLocal) {
      // ——— Modo por identificador_local (exige x-pos-serial) ———
      const headerPosSerial = String(req.headers.get("x-pos-serial") || req.headers.get("X-Pos-Serial") || "").trim();
      if (!headerPosSerial) {
        return jsonErrorCompat("x-pos-serial é obrigatório quando se usa identificador_local.", 400, { code: "missing_pos_serial" });
      }

      const { data: posDevice, error: posErr } = await sb
        .from("pos_devices")
        .select("id, serial, condominio_id")
        .eq("tenant_id", tenantId)
        .eq("serial", headerPosSerial)
        .maybeSingle();

      if (posErr) return jsonErrorCompat("Erro ao buscar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
      if (!posDevice) return jsonErrorCompat("POS não cadastrado (pos_devices).", 401, { code: "pos_not_found" });

      const condominioId = posDevice.condominio_id;
      if (!condominioId) return jsonErrorCompat("POS sem condominio_id.", 400, { code: "pos_no_condominio" });

      const { data: machineRow, error: machErr } = await sb
        .from("condominio_maquinas")
        .select("id,identificador_local,condominio_id")
        .eq("tenant_id", tenantId)
        .eq("condominio_id", condominioId)
        .eq("identificador_local", identificadorLocal)
        .eq("ativa", true)
        .maybeSingle();

      if (machErr) return jsonErrorCompat("Erro ao buscar máquina.", 500, { code: "db_error", extra: { details: machErr.message } });
      if (!machineRow) return jsonErrorCompat("Máquina não encontrada ou inativa.", 404, { code: "machine_not_found" });

      const machine = machineRow as MachineRow;

      const { data: cycleRows, error: cycleErr } = await sb
        .from("ciclos")
        .select("id,status,maquina_id,condominio_id,pagamento_id,created_at")
        .eq("tenant_id", tenantId)
        .eq("maquina_id", machine.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (cycleErr) {
        return jsonErrorCompat("Erro ao buscar ciclos da máquina.", 500, { code: "db_error", extra: { details: cycleErr.message } });
      }

      const cycle = pickBestCycleByStatus((cycleRows ?? []) as CycleRow[]);

      if (String(cycle?.status).toUpperCase() === "FINALIZADO") {
        const availability = availabilityFromCycle(cycle);
        return buildResponse({
          payment: null,
          cycle: cycle as CycleRow,
          command: null,
          machine,
          availability,
        });
      }

      let command: CommandRow | null = null;
      if (cycle?.id) {
        const { data: cmdData } = await sb
          .from("iot_commands")
          .select("id,cmd_id,status,created_at,expires_at,payload")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .filter("payload->>ciclo_id", "eq", String(cycle.id))
          .maybeSingle();
        command = cmdData || null;
        if (!command && cycle.pagamento_id) {
          const { data: cmdByPay } = await sb
            .from("iot_commands")
            .select("id,cmd_id,status,created_at,expires_at,payload")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(1)
            .filter("payload->>pagamento_id", "eq", String(cycle.pagamento_id))
            .maybeSingle();
          command = cmdByPay || null;
        }
      }

      let payment: PaymentRow | null = null;
      if (cycle?.pagamento_id) {
        const { data: payRow } = await sb
          .from("pagamentos")
          .select("id,status,valor_centavos,metodo,created_at")
          .eq("tenant_id", tenantId)
          .eq("id", cycle.pagamento_id)
          .maybeSingle();
        payment = payRow || null;
      }

      const availability = availabilityFromCycle(cycle);
      return buildResponse({
        payment,
        cycle: cycle as CycleRow,
        command,
        machine,
        availability,
      });
    }

    return jsonErrorCompat("Informe pagamento_id ou identificador_local.", 400, {
      code: "missing_param",
      extra: { expected: ["pagamento_id", "identificador_local"] },
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
