export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";

function parsePagination(url: string) {
  const u = new URL(url);
  const search = (u.searchParams.get("search") || "").trim();
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));
  return { search, page, limit };
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const { search, page, limit } = parsePagination(req.url);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const sb = supabaseAdmin() as any;

    let q = sb.from("condominios").select("id,nome", { count: "exact" }).eq("tenant_id", tenantId).order("nome", { ascending: true }).range(from, to);

    if (search) {
      q = q.ilike("nome", `%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) return jsonErrorCompat("Erro ao listar condomínios.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({
      ok: true,
      items: data || [],
      page,
      limit,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / limit)),
    });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao listar condomínios.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const nome = String(body?.nome || "").trim();

    if (!nome) return jsonErrorCompat("nome é obrigatório.", 400, { code: "missing_nome" });

    const sb = supabaseAdmin() as any;

    const { data: dup, error: dupErr } = await sb
      .from("condominios")
      .select("id,nome")
      .eq("tenant_id", tenantId)
      .ilike("nome", nome)
      .limit(1)
      .maybeSingle();

    if (dupErr) return jsonErrorCompat("Erro ao validar nome do condomínio.", 500, { code: "db_error", extra: { details: dupErr.message } });
    if (dup) return jsonErrorCompat("Condomínio já existe com esse nome.", 409, { code: "duplicate_condominio" });

    const { data, error } = await sb
      .from("condominios")
      .insert({ tenant_id: tenantId, nome })
      .select("id,nome")
      .single();

    if (error) return jsonErrorCompat("Erro ao criar condomínio.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao criar condomínio.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
