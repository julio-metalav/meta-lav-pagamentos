export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

const REPLAYABLE_STATUS = new Set(["pending", "retrying", "dead"]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const actor = String(body?.actor || "system").trim() || "system";
    const note = String(body?.note || "manual replay requested").trim();

    const sb = supabaseAdmin() as any;

    const { data: dlq, error: dlqErr } = await sb
      .from("alert_dlq")
      .select("id,event_code,severity,channel,target,payload,fingerprint,error,attempts,status")
      .eq("id", id)
      .maybeSingle();

    if (dlqErr) {
      return jsonErrorCompat("Erro ao buscar item da DLQ.", 500, {
        code: "db_error",
        extra: { details: dlqErr.message },
      });
    }

    if (!dlq) {
      return jsonErrorCompat("alert_dlq item not found", 404, { code: "alert_dlq_not_found" });
    }

    if (String(dlq.status) === "resolved") {
      return NextResponse.json({
        ok: true,
        replayed: false,
        reason: "already_resolved",
        item: dlq,
      });
    }

    if (!REPLAYABLE_STATUS.has(String(dlq.status))) {
      return jsonErrorCompat("status inválido para replay.", 409, { code: "invalid_dlq_status" });
    }

    const { data: route, error: routeErr } = await sb
      .from("alert_routes")
      .select("id,enabled,event_code,channel,target")
      .eq("enabled", true)
      .eq("channel", dlq.channel)
      .eq("target", dlq.target)
      .or(`event_code.eq.${dlq.event_code},event_code.eq.all`)
      .order("event_code", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (routeErr) {
      return jsonErrorCompat("Erro ao validar rota para replay.", 500, {
        code: "db_error",
        extra: { details: routeErr.message },
      });
    }

    if (!route) {
      const nextAttempts = Number(dlq.attempts || 0) + 1;
      const { data: updated, error: upErr } = await sb
        .from("alert_dlq")
        .update({
          attempts: nextAttempts,
          status: "dead",
          last_failed_at: new Date().toISOString(),
          next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          notes: `[${new Date().toISOString()}] replay sem rota ativa (${actor}): ${note}`,
        })
        .eq("id", id)
        .select("id,status,attempts,next_retry_at,updated_at")
        .maybeSingle();

      if (upErr) {
        return jsonErrorCompat("Erro ao atualizar DLQ sem rota.", 500, {
          code: "db_error",
          extra: { details: upErr.message },
        });
      }

      await sb.from("alert_dispatch_log").insert({
        event_code: dlq.event_code,
        severity: dlq.severity,
        fingerprint: dlq.fingerprint,
        channel: dlq.channel,
        target: dlq.target,
        status: "failed",
        error: "manual_replay_without_active_route",
      });

      return NextResponse.json({
        ok: true,
        replayed: false,
        reason: "no_active_route",
        item: updated,
      });
    }

    const { data: updated, error: updateErr } = await sb
      .from("alert_dlq")
      .update({
        attempts: Number(dlq.attempts || 0) + 1,
        status: "retrying",
        error: "manual_replay_queued",
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: `[${new Date().toISOString()}] replay enfileirado (${actor}): ${note}`,
      })
      .eq("id", id)
      .select("id,status,attempts,next_retry_at,updated_at")
      .maybeSingle();

    if (updateErr) {
      return jsonErrorCompat("Erro ao enfileirar replay da DLQ.", 500, {
        code: "db_error",
        extra: { details: updateErr.message },
      });
    }

    await sb.from("alert_dispatch_log").insert({
      event_code: dlq.event_code,
      severity: dlq.severity,
      fingerprint: dlq.fingerprint,
      channel: dlq.channel,
      target: dlq.target,
      status: "skipped_dedupe",
      error: "manual_replay_queued",
    });

    return NextResponse.json({
      ok: true,
      replayed: true,
      route_id: route.id,
      item: updated,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no replay da DLQ.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
