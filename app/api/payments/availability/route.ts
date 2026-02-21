export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { parseAvailabilityInput } from "@/lib/payments/contracts";
import { getTenantIdFromRequest } from "@/lib/tenant";

const PENDING_TTL_SEC = Number(process.env.PAYMENTS_PENDING_TTL_SEC || 300);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parseAvailabilityInput(body);
    if (!parsed.ok) return jsonErrorCompat(parsed.message, 400, { code: parsed.code });

    const input = parsed.data;
    const tenantId = getTenantIdFromRequest(req);
    const sb = supabaseAdmin() as any;

    const { data: machine, error: mErr } = await sb
      .from("condominio_maquinas")
      .select("id, condominio_id, ativa")
      .eq("tenant_id", tenantId)
      .eq("id", input.condominio_maquinas_id)
      .eq("condominio_id", input.condominio_id)
      .maybeSingle();

    if (mErr) return jsonErrorCompat("Erro ao consultar máquina.", 500, { code: "db_error", extra: { details: mErr.message } });
    if (!machine || !machine.ativa) return jsonErrorCompat("machine not found", 404, { code: "machine_not_found" });

    const { data: openCycle, error: cErr } = await sb
      .from("ciclos")
      .select("id,status,eta_livre_at,created_at")
      .eq("tenant_id", tenantId)
      .eq("maquina_id", input.condominio_maquinas_id)
      .in("status", ["AGUARDANDO_LIBERACAO", "LIBERADO", "EM_USO"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cErr) return jsonErrorCompat("Erro ao consultar disponibilidade.", 500, { code: "db_error", extra: { details: cErr.message } });

    if (!openCycle) {
      return NextResponse.json({
        ok: true,
        machine: {
          id: input.condominio_maquinas_id,
          status: "available",
          reserved_until: null,
        },
      });
    }

    const now = Date.now();
    const createdAtMs = openCycle.created_at ? new Date(openCycle.created_at).getTime() : now;
    const pendingDeadlineMs = createdAtMs + PENDING_TTL_SEC * 1000;

    const reservedUntil = openCycle.eta_livre_at
      ? new Date(openCycle.eta_livre_at).toISOString()
      : openCycle.status === "AGUARDANDO_LIBERACAO"
      ? new Date(pendingDeadlineMs).toISOString()
      : null;

    const isPendingStale = openCycle.status === "AGUARDANDO_LIBERACAO" && now >= pendingDeadlineMs;

    if (isPendingStale) {
      const { error: abortErr } = await sb
        .from("ciclos")
        .update({ status: "ABORTADO" })
        .eq("tenant_id", tenantId)
        .eq("id", openCycle.id)
        .eq("status", "AGUARDANDO_LIBERACAO");

      if (abortErr) {
        return jsonErrorCompat("Erro ao expirar reserva pendente.", 500, {
          code: "db_error",
          extra: { details: abortErr.message },
        });
      }

      return NextResponse.json({
        ok: true,
        machine: {
          id: input.condominio_maquinas_id,
          status: "available",
          reserved_until: null,
        },
      });
    }

    const retryAfterSec = reservedUntil ? Math.max(0, Math.ceil((new Date(reservedUntil).getTime() - now) / 1000)) : 120;
    return jsonErrorCompat("machine reserved", 409, {
      code: "reserved",
      retry_after_sec: retryAfterSec,
      extra: { reserved_until: reservedUntil },
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado no availability.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
