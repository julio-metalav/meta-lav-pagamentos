export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

function parseQuery(url: string) {
  const u = new URL(url);
  const status = String(u.searchParams.get("status") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));
  return { status, limit };
}

export async function GET(req: Request) {
  try {
    const { status, limit } = parseQuery(req.url);
    const sb = supabaseAdmin() as any;

    let q = sb
      .from("alert_dispatch_log")
      .select("id,event_code,severity,channel,target,status,error,sent_at")
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar dispatch log.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao listar dispatch log.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
