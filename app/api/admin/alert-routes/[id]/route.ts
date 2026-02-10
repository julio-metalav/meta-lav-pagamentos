export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

const ALLOWED_CHANNELS = new Set(["whatsapp", "telegram", "email", "discord"]);
const ALLOWED_SEVERITIES = new Set(["info", "warning", "critical"]);
const ALLOWED_EVENT_CODES = new Set(["all", "stale_pending_cycles", "expired_backlog_high", "monitor_error"]);

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const patch: Record<string, unknown> = {};

    if (body?.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }

    if (body?.channel !== undefined) {
      const channel = String(body.channel || "").trim().toLowerCase();
      if (!ALLOWED_CHANNELS.has(channel)) {
        return jsonErrorCompat("channel inválido.", 400, { code: "invalid_channel" });
      }
      patch.channel = channel;
    }

    if (body?.target !== undefined) {
      const target = String(body.target || "").trim();
      if (!target) {
        return jsonErrorCompat("target inválido.", 400, { code: "invalid_target" });
      }
      patch.target = target;
    }

    if (body?.event_code !== undefined) {
      const event_code = String(body.event_code || "").trim().toLowerCase();
      if (!ALLOWED_EVENT_CODES.has(event_code)) {
        return jsonErrorCompat("event_code inválido.", 400, { code: "invalid_event_code" });
      }
      patch.event_code = event_code;
    }

    if (body?.severity_min !== undefined) {
      const severity_min = String(body.severity_min || "").trim().toLowerCase();
      if (!ALLOWED_SEVERITIES.has(severity_min)) {
        return jsonErrorCompat("severity_min inválido.", 400, { code: "invalid_severity_min" });
      }
      patch.severity_min = severity_min;
    }

    if (body?.dedupe_window_sec !== undefined) {
      const dedupe_window_sec = Number(body.dedupe_window_sec);
      if (!Number.isInteger(dedupe_window_sec) || dedupe_window_sec < 0 || dedupe_window_sec > 86400) {
        return jsonErrorCompat("dedupe_window_sec inválido (0..86400).", 400, {
          code: "invalid_dedupe_window_sec",
        });
      }
      patch.dedupe_window_sec = dedupe_window_sec;
    }

    if (Object.keys(patch).length === 0) {
      return jsonErrorCompat("nada para atualizar.", 400, { code: "empty_patch" });
    }

    const sb = supabaseAdmin() as any;

    const { data: current, error: curErr } = await sb
      .from("alert_routes")
      .select("id,event_code,channel,target")
      .eq("id", id)
      .maybeSingle();

    if (curErr) return jsonErrorCompat("Erro ao buscar alert route.", 500, { code: "db_error", extra: { details: curErr.message } });
    if (!current) return jsonErrorCompat("alert_route not found", 404, { code: "alert_route_not_found" });

    const nextEvent = String(patch.event_code ?? current.event_code);
    const nextChannel = String(patch.channel ?? current.channel);
    const nextTarget = String(patch.target ?? current.target);

    const { data: dup, error: dupErr } = await sb
      .from("alert_routes")
      .select("id")
      .eq("event_code", nextEvent)
      .eq("channel", nextChannel)
      .eq("target", nextTarget)
      .neq("id", id)
      .maybeSingle();

    if (dupErr) return jsonErrorCompat("Erro ao validar rota duplicada.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("Rota já existe para event_code/channel/target.", 409, { code: "duplicate_alert_route" });

    const { data, error } = await sb
      .from("alert_routes")
      .update(patch)
      .eq("id", id)
      .select("id,enabled,event_code,channel,target,severity_min,dedupe_window_sec,created_at,updated_at")
      .maybeSingle();

    if (error) return jsonErrorCompat("Erro ao atualizar alert route.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("alert_route not found", 404, { code: "alert_route_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao atualizar alert route.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sb = supabaseAdmin() as any;

    const { data, error } = await sb
      .from("alert_routes")
      .delete()
      .eq("id", id)
      .select("id,enabled,event_code,channel,target,severity_min,dedupe_window_sec,created_at,updated_at")
      .maybeSingle();

    if (error) return jsonErrorCompat("Erro ao remover alert route.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("alert_route not found", 404, { code: "alert_route_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao remover alert route.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
