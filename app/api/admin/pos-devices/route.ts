export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const condominio_id = String(u.searchParams.get("condominio_id") || "").trim();
    const search = String(u.searchParams.get("search") || "").trim();

    const sb = supabaseAdmin() as any;
    let q = sb.from("pos_devices").select("id,serial,condominio_id,updated_at").order("updated_at", { ascending: false }).limit(200);
    if (condominio_id) q = q.eq("condominio_id", condominio_id);
    if (search) q = q.ilike("serial", `%${search}%`);

    const { data, error } = await q;
    if (error) return jsonErrorCompat("Erro ao listar POS devices.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao listar POS devices.", 500, {
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
    const { data: dup, error: dupErr } = await sb.from("pos_devices").select("id").eq("serial", serial).maybeSingle();
    if (dupErr) return jsonErrorCompat("Erro ao validar POS serial.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("POS já existe com este serial.", 409, { code: "duplicate_pos_serial" });

    const { data, error } = await sb.from("pos_devices").insert({ serial, condominio_id }).select("id,serial,condominio_id,updated_at").single();
    if (error) return jsonErrorCompat("Erro ao criar POS device.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao criar POS device.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
