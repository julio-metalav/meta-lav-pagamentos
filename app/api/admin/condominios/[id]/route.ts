export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const { id } = await ctx.params;
    const sb = supabaseAdmin() as any;

    const { data, error } = await sb.from("condominios").select("id,nome").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (error) return jsonErrorCompat("Erro ao buscar condomínio.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("condominio not found", 404, { code: "condominio_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao buscar condomínio.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const nome = body?.nome !== undefined ? String(body.nome || "").trim() : null;
    if (nome !== null && !nome) return jsonErrorCompat("nome inválido.", 400, { code: "invalid_nome" });

    const patch: Record<string, unknown> = {};
    if (nome !== null) patch.nome = nome;

    if (Object.keys(patch).length === 0) {
      return jsonErrorCompat("nada para atualizar.", 400, { code: "empty_patch" });
    }

    const sb = supabaseAdmin() as any;

    const { data, error } = await sb.from("condominios").update(patch).eq("tenant_id", tenantId).eq("id", id).select("id,nome").maybeSingle();

    if (error) return jsonErrorCompat("Erro ao atualizar condomínio.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("condominio not found", 404, { code: "condominio_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao atualizar condomínio.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
