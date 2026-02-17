export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

type MachineRow = {
  condominio_maquinas_id: string;
  identificador_local: string;
  tipo_maquina: string;
  last_cycle_id: string | null;
  last_cycle_status: string | null;
  busy_on_at: string | null;
  busy_off_at: string | null;
  status: "AVAILABLE" | "PENDING" | "IN_USE" | "ERROR";
  stale_pending: boolean;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const STALE_PENDING_MS = 20 * 60 * 1000;

function computeStatus(row: MachineRow, cycleCreatedAt: string | null) {
  const pendingBase = row.last_cycle_status && row.last_cycle_status.toUpperCase() !== "FINALIZADO";
  const busyOn = row.busy_on_at ? new Date(row.busy_on_at) : null;
  const busyOff = row.busy_off_at ? new Date(row.busy_off_at) : null;

  if (!row.last_cycle_status || row.last_cycle_status.toUpperCase() === "FINALIZADO") {
    row.status = "AVAILABLE";
    row.stale_pending = false;
    return;
  }

  if (busyOn && !busyOff) {
    row.status = "IN_USE";
    row.stale_pending = false;
    return;
  }

  const createdAt = cycleCreatedAt ? new Date(cycleCreatedAt) : null;
  if (pendingBase) {
    const isStale = createdAt ? Date.now() - createdAt.getTime() > STALE_PENDING_MS : false;
    row.status = isStale ? "ERROR" : "PENDING";
    row.stale_pending = Boolean(isStale);
    return;
  }

  row.status = "AVAILABLE";
  row.stale_pending = false;
}

export async function GET(req: Request) {
  const sb = supabaseAdmin() as any;
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const { data: machines, error: machineErr } = await sb
      .from("condominio_maquinas")
      .select("id,identificador_local,tipo")
      .order("identificador_local", { ascending: true })
      .limit(limit);

    if (machineErr) {
      return jsonErrorCompat("Erro ao consultar condominio_maquinas.", 500, {
        code: "db_error",
        extra: { details: machineErr.message },
      });
    }

    const ids = (machines || []).map((m: any) => m.id);
    const cyclesMap = new Map<string, any>();

    if (ids.length) {
      const { data: cycles, error: cycleErr } = await sb
        .from("ciclos")
        .select("id,status,maquina_id,busy_on_at,busy_off_at,created_at")
        .in("maquina_id", ids)
        .order("created_at", { ascending: false });

      if (cycleErr) {
        return jsonErrorCompat("Erro ao consultar ciclos.", 500, {
          code: "db_error",
          extra: { details: cycleErr.message },
        });
      }

      for (const cycle of cycles || []) {
        const machineId = String(cycle.maquina_id);
        if (!cyclesMap.has(machineId)) {
          cyclesMap.set(machineId, cycle);
        }
      }
    }

    const rows: MachineRow[] = (machines || []).map((m: any) => {
      const cycle = cyclesMap.get(String(m.id));
      const row: MachineRow = {
        condominio_maquinas_id: m.id,
        identificador_local: m.identificador_local,
        tipo_maquina: m.tipo,
        last_cycle_id: cycle?.id || null,
        last_cycle_status: cycle?.status || null,
        busy_on_at: cycle?.busy_on_at || null,
        busy_off_at: cycle?.busy_off_at || null,
        status: "AVAILABLE",
        stale_pending: false,
      };
      computeStatus(row, cycle?.created_at || null);
      return row;
    });

    const metrics = rows.reduce(
      (acc, row) => {
        acc.total++;
        if (row.status === "AVAILABLE") acc.available++;
        if (row.status === "PENDING") acc.pending++;
        if (row.status === "IN_USE") acc.in_use++;
        if (row.status === "ERROR") acc.error++;
        return acc;
      },
      { total: 0, available: 0, pending: 0, in_use: 0, error: 0 }
    );

    return NextResponse.json({ ok: true, metrics, rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado no machines-status.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
