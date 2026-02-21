export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURS_MIN = 1;
const HOURS_MAX = 168;
const HOURS_DEFAULT = 24;
const STALE_THRESHOLD_MINUTES = 20;
const MAX_ROWS_FALLBACK = 5000;
const MAX_MAQUINA_IDS = 2000;

function parseUuid(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!UUID_REGEX.test(trimmed)) {
    throw jsonErrorCompat("UUID inválido.", 400, { code: "invalid_uuid" });
  }
  return trimmed;
}

function parseHours(value: string | null) {
  if (!value) return HOURS_DEFAULT;
  const num = Number(value);
  if (!Number.isFinite(num)) throw jsonErrorCompat("hours inválido.", 400, { code: "invalid_hours" });
  const clamped = Math.min(HOURS_MAX, Math.max(HOURS_MIN, Math.floor(num)));
  return clamped;
}

function isRpcUnavailable(error: { code?: string; message?: string }): boolean {
  const code = String(error?.code ?? "").toUpperCase();
  const msg = String(error?.message ?? "").toLowerCase();
  if (code === "PGRST202") return true;
  if (msg.includes("rpc_dashboard0")) return true;
  return false;
}

type FallbackRowIc = { id: string; status: string; created_at: string | null; ack_at: string | null; gateway_id: string; condominio_maquinas_id: string | null };
type FallbackRowCiclo = { id: string; status: string; created_at: string | null };
type FallbackRowEvento = { created_at: string | null };

async function runFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  start: Date,
  end: Date,
  hours: number,
  condominioId: string | null,
  gatewayId: string | null
) {
  const startISO = start.toISOString();
  const endISO = end.toISOString();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000);
  const staleCutoffISO = staleCutoff.toISOString();
  const warnings: string[] = [];

  let maquinaIds: string[] = [];
  if (condominioId) {
    const { data: rows } = await sb
      .from("condominio_maquinas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominioId)
      .limit(MAX_MAQUINA_IDS + 1);
    maquinaIds = (rows ?? []).map((r: { id: string }) => r.id);
    if (maquinaIds.length > MAX_MAQUINA_IDS) {
      maquinaIds = maquinaIds.slice(0, MAX_MAQUINA_IDS);
      warnings.push("condominio_maquinas_id list truncated");
    }
  }

  let icList: FallbackRowIc[] = [];
  if (condominioId && maquinaIds.length === 0) {
    icList = [];
  } else {
    let qIc = sb
      .from("iot_commands")
      .select("id,status,created_at,ack_at,gateway_id,condominio_maquinas_id")
      .eq("tenant_id", tenantId)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_FALLBACK);
    if (gatewayId) qIc = qIc.eq("gateway_id", gatewayId);
    if (maquinaIds.length > 0) qIc = qIc.in("condominio_maquinas_id", maquinaIds);

    const { data: icRows, error: icErr } = await qIc;
    if (icErr) throw new Error(`iot_commands: ${icErr.message}`);
    icList = (icRows ?? []) as FallbackRowIc[];
  }

  const byStatusIc: Record<string, number> = {};
  let stalePendingCount = 0;
  let lastIotCommandAt: string | null = null;
  for (const r of icList) {
    const s = r.status ?? "unknown";
    byStatusIc[s] = (byStatusIc[s] ?? 0) + 1;
    const created = r.created_at ?? "";
    if (created > (lastIotCommandAt ?? "")) lastIotCommandAt = created;
    if (s === "PENDENTE" && created < staleCutoffISO && (r.ack_at == null || r.ack_at === "")) {
      stalePendingCount++;
    }
  }

  const { data: cicloRows, error: cicloErr } = await sb
    .from("ciclos")
    .select("id,status,created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", startISO)
    .lte("created_at", endISO)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS_FALLBACK);
  if (cicloErr) throw new Error(`ciclos: ${cicloErr.message}`);
  const cicloList = (cicloRows ?? []) as FallbackRowCiclo[];

  const byStatusCiclo: Record<string, number> = {};
  let staleWaitingCount = 0;
  for (const r of cicloList) {
    const s = r.status ?? "unknown";
    byStatusCiclo[s] = (byStatusCiclo[s] ?? 0) + 1;
    const created = r.created_at ?? "";
    if (s === "AGUARDANDO_LIBERACAO" && created < staleCutoffISO) staleWaitingCount++;
  }

  let lastEventoIotAt: string | null = null;
  if (condominioId && maquinaIds.length === 0) {
    lastEventoIotAt = null;
  } else {
    let qEv = sb
      .from("eventos_iot")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_FALLBACK);
    if (gatewayId) qEv = qEv.eq("gateway_id", gatewayId);
    if (maquinaIds.length > 0) qEv = qEv.in("maquina_id", maquinaIds);
    const { data: evRows, error: evErr } = await qEv;
    if (!evErr && Array.isArray(evRows) && evRows.length > 0) {
      const withTs = (evRows as FallbackRowEvento[]).map((r) => r.created_at).filter(Boolean) as string[];
      if (withTs.length) lastEventoIotAt = withTs.reduce((a, b) => (a > b ? a : b));
    }
  }

  if (icList.length >= MAX_ROWS_FALLBACK) warnings.push("iot_commands row limit reached");
  if (cicloList.length >= MAX_ROWS_FALLBACK) warnings.push("ciclos row limit reached");

  return {
    ok: true,
    mode: "fallback" as const,
    window: { start: startISO, end: endISO, hours },
    filters: { condominio_id: condominioId ?? null, gateway_id: gatewayId ?? null },
    iot_commands: {
      total: icList.length,
      by_status: byStatusIc,
      stale_pending: { threshold_minutes: STALE_THRESHOLD_MINUTES, count: stalePendingCount },
    },
    ciclos: {
      total: cicloList.length,
      by_status: byStatusCiclo,
      stale_waiting: { threshold_minutes: STALE_THRESHOLD_MINUTES, count: staleWaitingCount },
    },
    last_activity: {
      last_iot_command_at: lastIotCommandAt,
      last_evento_iot_at: lastEventoIotAt,
    },
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const url = new URL(req.url);
    const hours = parseHours(url.searchParams.get("hours"));
    const condominioId = parseUuid(url.searchParams.get("condominio_id"));
    const gatewayId = parseUuid(url.searchParams.get("gateway_id"));

    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("rpc_dashboard0", {
      p_inicio: start.toISOString(),
      p_fim: end.toISOString(),
      p_condominio_id: condominioId,
      p_gateway_id: gatewayId,
    });

    if (error) {
      if (isRpcUnavailable(error)) {
        try {
          const fallback = await runFallback(sb, tenantId, start, end, hours, condominioId, gatewayId);
          return NextResponse.json(fallback);
        } catch (fallbackErr) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          return jsonErrorCompat("Fallback do dashboard0 falhou.", 500, {
            code: "fallback_error",
            extra: { details: msg },
          });
        }
      }
      return jsonErrorCompat("Erro ao executar rpc_dashboard0.", 500, {
        code: "rpc_error",
        extra: { details: error.message ?? "rpc error" },
      });
    }

    if (!data || typeof data !== "object") {
      try {
        const fallback = await runFallback(sb, tenantId, start, end, hours, condominioId, gatewayId);
        return NextResponse.json(fallback);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        return jsonErrorCompat("Fallback do dashboard0 falhou.", 500, {
          code: "fallback_error",
          extra: { details: msg },
        });
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado no dashboard0.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
