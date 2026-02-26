export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";

function parsePagination(url: string) {
  const u = new URL(url);
  const search = (u.searchParams.get("search") || "").trim();
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));
  return { search, page, limit };
}

function normalizeText(v: unknown): string {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeOptionalText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function normalizeUf(v: unknown): string {
  return normalizeText(v).toUpperCase();
}

function isValidUf(uf: string): boolean {
  return /^[A-Z]{2}$/.test(uf);
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);

    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.condominios.read");
    if (!hasPerm) {
      console.warn("[admin/condominios GET] 403 forbidden", { user_id: sess.user.id, permission: "admin.condominios.read", hasPerm: false });
      return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });
    }

    const { search, page, limit } = parsePagination(req.url);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const sb = supabaseAdmin() as any;
    let q = sb
      .from("condominios")
      .select("id,nome,cidade,uf,ativo,codigo_condominio,created_at,updated_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("nome", { ascending: true });

    if (search) q = q.ilike("nome", `%${search}%`);
    const { data, error, count } = await q.range(from, to);
    if (error) return jsonErrorCompat("Erro ao listar condomínios.", 500, { code: "db_error", extra: { details: error.message } });

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
    return jsonErrorCompat("Erro inesperado ao listar condomínios.", 500, { code: "internal_error", extra: { details: msg } });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);

    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.condominios.write");
    if (!hasPerm) {
      console.warn("[admin/condominios POST] 403 forbidden", { user_id: sess.user.id, permission: "admin.condominios.write", hasPerm: false });
      return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const nome = normalizeText(body?.nome);
    const cidade = normalizeText(body?.cidade);
    const uf = normalizeUf(body?.uf);

    const ativo =
      typeof body?.ativo === "boolean"
        ? body.ativo
        : body?.ativo == null
          ? true
          : String(body.ativo).toLowerCase() === "true";

    const codigo_condominio = normalizeOptionalText(body?.codigo_condominio);

    if (!nome) return jsonErrorCompat("nome é obrigatório.", 400, { code: "missing_nome" });
    if (!cidade) return jsonErrorCompat("cidade é obrigatória.", 400, { code: "missing_cidade" });
    if (!uf) return jsonErrorCompat("uf é obrigatória.", 400, { code: "missing_uf" });
    if (!isValidUf(uf)) return jsonErrorCompat("uf inválida. Use 2 letras (ex.: MS).", 400, { code: "invalid_uf" });

    const sb = supabaseAdmin() as any;

    const { data: dupNome, error: dupNomeErr } = await sb
      .from("condominios")
      .select("id,nome")
      .eq("tenant_id", tenantId)
      .ilike("nome", nome)
      .limit(1)
      .maybeSingle();

    if (dupNomeErr) return jsonErrorCompat("Erro ao validar nome do condomínio.", 500, { code: "db_error", extra: { details: dupNomeErr.message } });
    if (dupNome) return jsonErrorCompat("Condomínio já existe com esse nome.", 409, { code: "duplicate_condominio_nome" });

    if (codigo_condominio) {
      const { data: dupCod, error: dupCodErr } = await sb
        .from("condominios")
        .select("id,codigo_condominio")
        .eq("tenant_id", tenantId)
        .eq("codigo_condominio", codigo_condominio)
        .limit(1)
        .maybeSingle();

      if (dupCodErr) return jsonErrorCompat("Erro ao validar código do condomínio.", 500, { code: "db_error", extra: { details: dupCodErr.message } });
      if (dupCod) return jsonErrorCompat("Já existe condomínio com esse código.", 409, { code: "duplicate_condominio_codigo" });
    }

    const { data, error } = await sb
      .from("condominios")
      .insert({ tenant_id: tenantId, nome, cidade, uf, ativo, codigo_condominio })
      .select("id,nome,cidade,uf,ativo,codigo_condominio,created_at,updated_at")
      .single();

    if (error) return jsonErrorCompat("Erro ao criar condomínio.", 500, { code: "db_error", extra: { details: error.message } });

    return NextResponse.json({ ok: true, item: data }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao criar condomínio.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
