export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

function parseQuery(url: string) {
  const u = new URL(url);
  const search = (u.searchParams.get("search") || "").trim();
  const condominio_id = (u.searchParams.get("condominio_id") || "").trim() || null;
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));
  return { search, condominio_id, page, limit };
}

export async function GET(req: Request) {
  try {
    const { search, condominio_id, page, limit } = parseQuery(req.url);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const sb = supabaseAdmin() as any;

    let q = sb
      .from("gateways")
      .select("id,serial,condominio_id,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (condominio_id) q = q.eq("condominio_id", condominio_id);
    if (search) q = q.ilike("serial", `%${search}%`);

    const { data, error, count } = await q;
    if (error) return jsonErrorCompat("Erro ao listar gateways.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({
      ok: true,
      items: data || [],
      page,
      limit,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / limit)),
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao listar gateways.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const serial = String(body?.serial || "").trim();
    const condominio_id = String(body?.condominio_id || "").trim();

    if (!serial) return jsonErrorCompat("serial é obrigatório.", 400, { code: "missing_serial" });
    if (!condominio_id) return jsonErrorCompat("condominio_id é obrigatório.", 400, { code: "missing_condominio_id" });

    const sb = supabaseAdmin() as any;

    const { data: cond, error: condErr } = await sb.from("condominios").select("id").eq("id", condominio_id).maybeSingle();
    if (condErr) return jsonErrorCompat("Erro ao validar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!cond) return jsonErrorCompat("condominio not found", 404, { code: "condominio_not_found" });

    const { data: dup, error: dupErr } = await sb.from("gateways").select("id,serial").eq("serial", serial).maybeSingle();
    if (dupErr) return jsonErrorCompat("Erro ao validar serial do gateway.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("Gateway já existe com este serial.", 409, { code: "duplicate_gateway_serial" });

    const { data, error } = await sb
      .from("gateways")
      .insert({ serial, condominio_id })
      .select("id,serial,condominio_id,created_at")
      .single();

    if (error) return jsonErrorCompat("Erro ao criar gateway.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao criar gateway.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
