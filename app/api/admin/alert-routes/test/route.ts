export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

function toSeverity(severityMin: string): "info" | "warning" | "critical" {
  const v = String(severityMin || "warning").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "info") return "info";
  return "warning";
}

async function upsertDlqOnFailure(admin: any, params: {
  route: any;
  eventCode: string;
  severity: "info" | "warning" | "critical";
  fingerprint: string;
  reason: string;
}) {
  const { route, eventCode, severity, fingerprint, reason } = params;

  const { data: existing } = await admin
    .from("alert_dlq")
    .select("id,attempts")
    .eq("channel", route.channel)
    .eq("target", route.target)
    .eq("fingerprint", fingerprint)
    .in("status", ["pending", "retrying"])
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("alert_dlq")
      .update({
        attempts: Number(existing.attempts || 0) + 1,
        status: "retrying",
        error: reason,
        last_failed_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  await admin.from("alert_dlq").insert({
    event_code: eventCode,
    severity,
    channel: route.channel,
    target: route.target,
    payload: {
      test: true,
      route_id: route.id,
      message: "manual route test",
    },
    fingerprint,
    error: reason,
    attempts: 1,
    status: "pending",
    first_failed_at: new Date().toISOString(),
    last_failed_at: new Date().toISOString(),
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const routeId = String(body?.route_id || "").trim();
    const actor = String(body?.actor || "dashboard").trim() || "dashboard";

    if (!routeId) return jsonErrorCompat("route_id é obrigatório.", 400, { code: "missing_route_id" });

    const admin = supabaseAdmin() as any;

    const { data: route, error: routeErr } = await admin
      .from("alert_routes")
      .select("id,enabled,event_code,channel,target,severity_min")
      .eq("id", routeId)
      .maybeSingle();

    if (routeErr) return jsonErrorCompat("Erro ao buscar rota.", 500, { code: "db_error", extra: { details: routeErr.message } });
    if (!route) return jsonErrorCompat("route not found", 404, { code: "route_not_found" });

    const eventCode = String(route.event_code || "all");
    const severity = toSeverity(route.severity_min);

    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ type: "route_test", route_id: route.id, ts_min: Math.floor(Date.now() / 60000) }))
      .digest("hex");

    // "Real" no sentido operacional: tenta dispatch no modo atual do ambiente.
    // Se PAYMENTS_ALERT_DISPATCH_SIMULATE=false, sem transport implementado -> falha (vai para DLQ).
    const simulateSuccess = String(process.env.PAYMENTS_ALERT_DISPATCH_SIMULATE || "true").toLowerCase() !== "false";

    if (simulateSuccess) {
      await admin.from("alert_dispatch_log").insert({
        event_code: eventCode,
        severity,
        fingerprint,
        channel: route.channel,
        target: route.target,
        status: "sent",
        error: null,
      });

      // resolve eventual item pendente da mesma rota/fingerprint
      await admin
        .from("alert_dlq")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: actor,
          notes: `[${new Date().toISOString()}] resolved by manual route test`,
        })
        .eq("channel", route.channel)
        .eq("target", route.target)
        .eq("fingerprint", fingerprint)
        .in("status", ["pending", "retrying", "dead"]);

      return NextResponse.json({
        ok: true,
        route_id: route.id,
        simulated: true,
        dispatch_status: "sent",
        message: "Teste executado com sucesso (modo simulado).",
      });
    }

    const reason = "dispatch_transport_not_implemented";

    await admin.from("alert_dispatch_log").insert({
      event_code: eventCode,
      severity,
      fingerprint,
      channel: route.channel,
      target: route.target,
      status: "failed",
      error: reason,
    });

    await upsertDlqOnFailure(admin, {
      route,
      eventCode,
      severity,
      fingerprint,
      reason,
    });

    return NextResponse.json({
      ok: true,
      route_id: route.id,
      simulated: false,
      dispatch_status: "failed",
      message: "Teste executado: falha registrada em DLQ (transporte não implementado).",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao testar rota.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
