export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

type MachineStatus = "AVAILABLE" | "PENDING" | "IN_USE" | "ERROR";

type CondominioRow = {
  id: string;
  nome: string;
  cidade?: string | null;
  uf?: string | null;
  ativo?: boolean | null;
  codigo_condominio?: string | null;
};

type MachineRow = {
  id: string;
  condominio_id: string;
  identificador_local: string | null;
  tipo: string | null; // "lavadora" | "secadora"
  ativa: boolean | null;
  gateway_id: string | null;
  pos_device_id: string | null;
  updated_at: string | null;
};

type CycleRow = {
  id: string;
  maquina_id: string | null;
  status: string | null;
  created_at: string | null;
  busy_on_at: string | null;
  busy_off_at: string | null;
};

type PrecoRow = {
  id?: string | null;
  maquina_id?: string | null;
  valor_centavos?: number | null;
  preco_centavos?: number | null;
  amount_centavos?: number | null;
  valor?: number | null;
  preco?: number | null;
  amount?: number | null;
  tipo?: string | null;
  tipo_maquina?: string | null;
  service_type?: string | null;
  categoria?: string | null;
  vigente_desde?: string | null;
  vigente_ate?: string | null;
  created_at?: string | null;
};

const STALE_PENDING_MINUTES = 20;
const STALE_PENDING_MS = STALE_PENDING_MINUTES * 60 * 1000;

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function computeStatus(cycle: CycleRow | undefined, nowMs: number) {
  let status: MachineStatus = "AVAILABLE";
  let stale_pending = false;

  if (!cycle) return { status, stale_pending } as const;

  const cycleStatus = String(cycle.status || "").toUpperCase();
  const createdAtMs = parseDate(cycle.created_at);

  if (cycleStatus === "FINALIZADO") {
    return { status: "AVAILABLE" as MachineStatus, stale_pending } as const;
  }

  if (cycle.busy_on_at && !cycle.busy_off_at) {
    return { status: "IN_USE" as MachineStatus, stale_pending } as const;
  }

  status = "PENDING";

  if (createdAtMs !== null && createdAtMs < nowMs - STALE_PENDING_MS) {
    stale_pending = true;
    status = "ERROR";
  }

  return { status, stale_pending } as const;
}

function pickAmountCents(row: PrecoRow): number | null {
  const centsCandidates: (keyof PrecoRow)[] = ["valor_centavos", "preco_centavos", "amount_centavos"];
  for (const k of centsCandidates) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  }
  const brlCandidates: (keyof PrecoRow)[] = ["valor", "preco", "amount"];
  for (const k of brlCandidates) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v * 100);
  }
  return null;
}

function normalizeServiceType(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function rowMatchesService(row: PrecoRow, machineTipo: string) {
  // Se a regra não declara tipo, aceitamos (compat com dados antigos).
  const candidates = [row.tipo, row.tipo_maquina, row.service_type, row.categoria].map(normalizeServiceType).filter(Boolean);
  if (candidates.length === 0) return true;
  return candidates.includes(machineTipo);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = getTenantIdFromRequest(req);

    // Segurança (diferente do machines-status atual): dashboard é admin-only.
    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const canReadConds = await requirePermission(sess.user.id, "admin.condominios.read");
    if (!canReadConds) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });
    const canReadMachines = await requirePermission(sess.user.id, "admin.maquinas.read");
    if (!canReadMachines) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const { id: condominioId } = await ctx.params;
    const sb = supabaseAdmin() as any;

    // 1) Loja
    const { data: cond, error: condErr } = await sb
      .from("condominios")
      .select("id,nome,cidade,uf,ativo,codigo_condominio")
      .eq("tenant_id", tenantId)
      .eq("id", condominioId)
      .maybeSingle();

    if (condErr) return jsonErrorCompat("Erro ao buscar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!cond) return jsonErrorCompat("condominio not found", 404, { code: "condominio_not_found" });

    // 2) Máquinas (equipamentos)
    const { data: machinesData, error: machinesErr } = await sb
      .from("condominio_maquinas")
      .select("id,condominio_id,identificador_local,tipo,ativa,gateway_id,pos_device_id,updated_at")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominioId)
      .order("identificador_local", { ascending: true })
      .limit(500);

    if (machinesErr) return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: machinesErr.message } });
    const machines = (machinesData || []) as MachineRow[];
    const machineIds = machines.map((m) => m.id).filter(Boolean);

    // 3) Último ciclo por máquina => status
    const lastCycleMap = new Map<string, CycleRow>();
    if (machineIds.length > 0) {
      const { data: cyclesData, error: cyclesErr } = await sb
        .from("ciclos")
        .select("id,maquina_id,status,created_at,busy_on_at,busy_off_at")
        .eq("tenant_id", tenantId)
        .in("maquina_id", machineIds)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (cyclesErr) return jsonErrorCompat("Erro ao buscar ciclos.", 500, { code: "db_error", extra: { details: cyclesErr.message } });

      const cycles = (cyclesData || []) as CycleRow[];
      for (const cycle of cycles) {
        const machineId = cycle.maquina_id ? String(cycle.maquina_id) : "";
        if (!machineId) continue;
        if (lastCycleMap.has(machineId)) continue;
        lastCycleMap.set(machineId, cycle);
      }
    }

    const nowMs = Date.now();
    const statusRows = machines.map((machine) => {
      const cycle = lastCycleMap.get(machine.id);
      const { status, stale_pending } = computeStatus(cycle, nowMs);
      return {
        maquina_id: machine.id,
        condominio_id: machine.condominio_id,
        identificador_local: machine.identificador_local,
        tipo: machine.tipo,
        ativa: !!machine.ativa,
        gateway_id: machine.gateway_id,
        pos_device_id: machine.pos_device_id,
        updated_at: machine.updated_at,
        last_cycle_id: cycle?.id || null,
        last_cycle_status: cycle?.status || null,
        last_cycle_created_at: cycle?.created_at || null,
        busy_on_at: cycle?.busy_on_at || null,
        busy_off_at: cycle?.busy_off_at || null,
        status,
        stale_pending,
      };
    });

    const metrics = statusRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status === "AVAILABLE") acc.available += 1;
        if (row.status === "PENDING") acc.pending += 1;
        if (row.status === "IN_USE") acc.in_use += 1;
        if (row.status === "ERROR") acc.error += 1;
        if (row.stale_pending) acc.stale_pending += 1;
        return acc;
      },
      { total: 0, available: 0, pending: 0, in_use: 0, error: 0, stale_pending: 0 }
    );

    // 4) Preços (batch) + flag agendado
    const nowIso = new Date().toISOString();
    const priceByMachine: Record<
      string,
      { current_price_centavos: number | null; has_scheduled_price: boolean; current_rule_id: string | null }
    > = {};

    for (const m of machines) {
      priceByMachine[m.id] = { current_price_centavos: null, has_scheduled_price: false, current_rule_id: null };
    }

    if (machineIds.length > 0) {
      const { data: priceRowsData, error: priceErr } = await sb
        .from("precos_ciclo")
        .select("*")
        .in("maquina_id", machineIds)
        .order("vigente_desde", { ascending: false })
        .limit(5000);

      if (priceErr) return jsonErrorCompat("Erro ao consultar precos_ciclo.", 500, { code: "db_error", extra: { details: priceErr.message } });

      const priceRows = (priceRowsData || []) as PrecoRow[];

      // detect scheduled first (any vigente_desde > now)
      for (const r of priceRows) {
        const mid = String(r.maquina_id || "");
        if (!mid || !priceByMachine[mid]) continue;
        const vd = r.vigente_desde ? Date.parse(String(r.vigente_desde)) : NaN;
        if (Number.isFinite(vd) && vd > Date.parse(nowIso)) {
          priceByMachine[mid].has_scheduled_price = true;
        }
      }

      // choose current (latest vigente_desde <= now and within vigente_ate)
      const nowMs2 = Date.parse(nowIso);
      const machineTipoMap = new Map<string, string>();
      for (const m of machines) machineTipoMap.set(m.id, normalizeServiceType(m.tipo));

      for (const r of priceRows) {
        const mid = String(r.maquina_id || "");
        if (!mid || !priceByMachine[mid]) continue;
        if (priceByMachine[mid].current_price_centavos !== null) continue; // already chosen (because ordered desc)

        const vdMs = r.vigente_desde ? Date.parse(String(r.vigente_desde)) : NaN;
        if (!Number.isFinite(vdMs)) continue;
        if (vdMs > nowMs2) continue;

        const vaMs = r.vigente_ate ? Date.parse(String(r.vigente_ate)) : NaN;
        if (Number.isFinite(vaMs) && vaMs < nowMs2) continue;

        const mt = machineTipoMap.get(mid) || "";
        if (mt && !rowMatchesService(r, mt)) continue;

        const cents = pickAmountCents(r);
        if (cents === null) continue;

        priceByMachine[mid].current_price_centavos = cents;
        priceByMachine[mid].current_rule_id = r.id ? String(r.id) : null;
      }
    }

    return NextResponse.json({
      ok: true,
      loja: cond as CondominioRow,
      metrics,
      machines,
      status_rows: statusRows,
      prices_by_machine: priceByMachine,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado no dashboard da loja.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
