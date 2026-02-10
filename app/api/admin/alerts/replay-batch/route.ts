export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

const REPLAYABLE = ["pending", "retrying", "dead"];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const status = String(body?.status || "pending").trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(body?.limit || 10)));
    const actor = String(body?.actor || "dashboard-batch").trim() || "dashboard-batch";

    const statuses = status === "all" ? REPLAYABLE : [status];

    const sb = supabaseAdmin() as any;

    const { data: items, error: qErr } = await sb
      .from("alert_dlq")
      .select("id,status")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (qErr) {
      return jsonErrorCompat("Erro ao listar DLQ para replay em lote.", 500, {
        code: "db_error",
        extra: { details: qErr.message },
      });
    }

    const list = (items || []) as Array<{ id: string; status: string }>;
    if (!list.length) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        replayed: 0,
        failed: 0,
        details: [],
        message: "Nenhum item elegível para replay.",
      });
    }

    let replayed = 0;
    let failed = 0;
    const details: Array<{ id: string; ok: boolean; reason?: string }> = [];

    for (const item of list) {
      try {
        const { data: dlq, error: dlqErr } = await sb
          .from("alert_dlq")
          .select("id,event_code,severity,channel,target,fingerprint,attempts,status")
          .eq("id", item.id)
          .maybeSingle();

        if (dlqErr || !dlq) {
          failed += 1;
          details.push({ id: item.id, ok: false, reason: dlqErr?.message || "not_found" });
          continue;
        }

        const { data: route } = await sb
          .from("alert_routes")
          .select("id,event_code,channel,target,enabled")
          .eq("enabled", true)
          .eq("channel", dlq.channel)
          .eq("target", dlq.target)
          .or(`event_code.eq.${dlq.event_code},event_code.eq.all`)
          .order("event_code", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!route) {
          await sb
            .from("alert_dlq")
            .update({
              attempts: Number(dlq.attempts || 0) + 1,
              status: "dead",
              last_failed_at: new Date().toISOString(),
              next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              notes: `[${new Date().toISOString()}] replay-batch sem rota ativa (${actor})`,
            })
            .eq("id", dlq.id);

          await sb.from("alert_dispatch_log").insert({
            event_code: dlq.event_code,
            severity: dlq.severity,
            fingerprint: dlq.fingerprint,
            channel: dlq.channel,
            target: dlq.target,
            status: "failed",
            error: "batch_replay_without_active_route",
          });

          failed += 1;
          details.push({ id: dlq.id, ok: false, reason: "no_active_route" });
          continue;
        }

        await sb
          .from("alert_dlq")
          .update({
            attempts: Number(dlq.attempts || 0) + 1,
            status: "retrying",
            error: "batch_replay_queued",
            next_retry_at: new Date().toISOString(),
            notes: `[${new Date().toISOString()}] replay-batch enfileirado (${actor})`,
          })
          .eq("id", dlq.id);

        await sb.from("alert_dispatch_log").insert({
          event_code: dlq.event_code,
          severity: dlq.severity,
          fingerprint: dlq.fingerprint,
          channel: dlq.channel,
          target: dlq.target,
          status: "skipped_dedupe",
          error: "batch_replay_queued",
        });

        replayed += 1;
        details.push({ id: dlq.id, ok: true });
      } catch (err: unknown) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        details.push({ id: item.id, ok: false, reason: msg });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: list.length,
      replayed,
      failed,
      details,
      message: `Replay em lote concluído: ${replayed} ok, ${failed} falhas.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado no replay em lote.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
