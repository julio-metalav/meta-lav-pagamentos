export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

const ALLOWED_CHANNELS = new Set(["whatsapp", "telegram", "email", "discord"]);
const ALLOWED_SEVERITIES = new Set(["info", "warning", "critical"]);
const ALLOWED_EVENT_CODES = new Set(["all", "stale_pending_cycles", "expired_backlog_high", "monitor_error"]);

function parseQuery(url: string) {
  const u = new URL(url);
  const channel = String(u.searchParams.get("channel") || "").trim().toLowerCase();
  const event_code = String(u.searchParams.get("event_code") || "").trim().toLowerCase();
  const enabledRaw = String(u.searchParams.get("enabled") || "").trim().toLowerCase();
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));

  let enabled: boolean | null = null;
  if (enabledRaw === "true") enabled = true;
  if (enabledRaw === "false") enabled = false;

  return { channel, event_code, enabled, page, limit };
}

export async function GET(req: Request) {
  try {
    const { channel, event_code, enabled, page, limit } = parseQuery(req.url);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (channel && !ALLOWED_CHANNELS.has(channel)) {
      return jsonErrorCompat("channel inválido.", 400, { code: "invalid_channel" });
    }

    if (event_code && !ALLOWED_EVENT_CODES.has(event_code)) {
      return jsonErrorCompat("event_code inválido.", 400, { code: "invalid_event_code" });
    }

    const sb = supabaseAdmin() as any;

    let q = sb
      .from("alert_routes")
      .select("id,enabled,event_code,channel,target,severity_min,dedupe_window_sec,created_at,updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (channel) q = q.eq("channel", channel);
    if (event_code) q = q.eq("event_code", event_code);
    if (enabled !== null) q = q.eq("enabled", enabled);

    const { data, error, count } = await q;
    if (error) return jsonErrorCompat("Erro ao listar alert routes.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({
      ok: true,
      items: data || [],
      page,
      limit,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / limit)),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar alert routes.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const channel = String(body?.channel || "").trim().toLowerCase();
    const target = String(body?.target || "").trim();
    const event_code = String(body?.event_code || "all").trim().toLowerCase();
    const severity_min = String(body?.severity_min || "warning").trim().toLowerCase();

    const enabled = body?.enabled === undefined ? true : Boolean(body.enabled);
    const dedupe_window_sec = Number(body?.dedupe_window_sec ?? 900);

    if (!ALLOWED_CHANNELS.has(channel)) return jsonErrorCompat("channel inválido.", 400, { code: "invalid_channel" });
    if (!target) return jsonErrorCompat("target é obrigatório.", 400, { code: "missing_target" });
    if (!ALLOWED_EVENT_CODES.has(event_code)) return jsonErrorCompat("event_code inválido.", 400, { code: "invalid_event_code" });
    if (!ALLOWED_SEVERITIES.has(severity_min)) return jsonErrorCompat("severity_min inválido.", 400, { code: "invalid_severity_min" });
    if (!Number.isInteger(dedupe_window_sec) || dedupe_window_sec < 0 || dedupe_window_sec > 86400) {
      return jsonErrorCompat("dedupe_window_sec inválido (0..86400).", 400, { code: "invalid_dedupe_window_sec" });
    }

    const sb = supabaseAdmin() as any;

    const { data: dup, error: dupErr } = await sb
      .from("alert_routes")
      .select("id")
      .eq("event_code", event_code)
      .eq("channel", channel)
      .eq("target", target)
      .maybeSingle();

    if (dupErr) return jsonErrorCompat("Erro ao validar rota duplicada.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("Rota já existe para event_code/channel/target.", 409, { code: "duplicate_alert_route" });

    const { data, error } = await sb
      .from("alert_routes")
      .insert({
        enabled,
        event_code,
        channel,
        target,
        severity_min,
        dedupe_window_sec,
      })
      .select("id,enabled,event_code,channel,target,severity_min,dedupe_window_sec,created_at,updated_at")
      .single();

    if (error) return jsonErrorCompat("Erro ao criar alert route.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao criar alert route.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
