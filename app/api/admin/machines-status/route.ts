export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

type MachineStatus = "AVAILABLE" | "PENDING" | "IN_USE" | "ERROR";

type MachineRow = {
  id: string;
  condominio_id: string;
  identificador_local: string | null;
  tipo: string | null;
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

const STALE_PENDING_MINUTES = 20;
const STALE_PENDING_MS = STALE_PENDING_MINUTES * 60 * 1000;
const DEFAULT_MACHINE_LIMIT = 1000;

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_MACHINE_LIMIT;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_MACHINE_LIMIT;
  return Math.min(5000, Math.max(1, Math.floor(num)));
}

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const condominioId = String(url.searchParams.get("condominio_id") || "").trim();
    const includeInactive = url.searchParams.get("include_inactive") === "true";
    const limit = parseLimit(url.searchParams.get("limit"));

    const sb = supabaseAdmin() as any;

    let machinesQuery = sb
      .from("condominio_maquinas")
      .select("id,condominio_id,identificador_local,tipo,ativa,gateway_id,pos_device_id,updated_at")
      .order("identificador_local", { ascending: true })
      .limit(limit);

    if (!includeInactive) machinesQuery = machinesQuery.eq("ativa", true);
    if (condominioId) machinesQuery = machinesQuery.eq("condominio_id", condominioId);

    const { data: machinesData, error: machinesErr } = await machinesQuery;
    if (machinesErr) {
      return jsonErrorCompat("Erro ao listar máquinas.", 500, { code: "db_error", extra: { details: machinesErr.message } });
    }

    const machines = (machinesData || []) as MachineRow[];
    const machineIds = machines.map((m) => m.id).filter(Boolean);

    const lastCycleMap = new Map<string, CycleRow>();

    if (machineIds.length > 0) {
      const { data: cyclesData, error: cyclesErr } = await sb
        .from("ciclos")
        .select("id,maquina_id,status,created_at,busy_on_at,busy_off_at")
        .in("maquina_id", machineIds)
        .order("created_at", { ascending: false });

      if (cyclesErr) {
        return jsonErrorCompat("Erro ao buscar ciclos.", 500, { code: "db_error", extra: { details: cyclesErr.message } });
      }

      const cycles = (cyclesData || []) as CycleRow[];
      for (const cycle of cycles) {
        const machineId = cycle.maquina_id ? String(cycle.maquina_id) : "";
        if (!machineId) continue;
        if (lastCycleMap.has(machineId)) continue;
        lastCycleMap.set(machineId, cycle);
      }
    }

    const nowMs = Date.now();
    const rows = machines.map((machine) => {
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

    const metrics = rows.reduce(
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

    return NextResponse.json({ ok: true, metrics, rows });
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado ao calcular status de máquinas.", 500, {
      code: "internal_error",
      extra: { details: message },
    });
  }
}
