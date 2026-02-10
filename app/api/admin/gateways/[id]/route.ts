export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sb = supabaseAdmin() as any;

    const { data, error } = await sb.from("gateways").select("id,serial,condominio_id,created_at").eq("id", id).maybeSingle();
    if (error) return jsonErrorCompat("Erro ao buscar gateway.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("gateway not found", 404, { code: "gateway_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao buscar gateway.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const serial = body?.serial !== undefined ? String(body.serial || "").trim() : null;
    const condominio_id = body?.condominio_id !== undefined ? String(body.condominio_id || "").trim() : null;

    const patch: Record<string, unknown> = {};
    if (serial !== null) {
      if (!serial) return jsonErrorCompat("serial inválido.", 400, { code: "invalid_serial" });
      patch.serial = serial;
    }

    if (condominio_id !== null) {
      if (!condominio_id) return jsonErrorCompat("condominio_id inválido.", 400, { code: "invalid_condominio_id" });
      patch.condominio_id = condominio_id;
    }

    if (Object.keys(patch).length === 0) return jsonErrorCompat("nada para atualizar.", 400, { code: "empty_patch" });

    const sb = supabaseAdmin() as any;

    if (typeof patch.condominio_id === "string") {
      const { data: cond, error: condErr } = await sb.from("condominios").select("id").eq("id", patch.condominio_id).maybeSingle();
      if (condErr) return jsonErrorCompat("Erro ao validar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
      if (!cond) return jsonErrorCompat("condominio not found", 404, { code: "condominio_not_found" });
    }

    if (typeof patch.serial === "string") {
      const { data: dup, error: dupErr } = await sb.from("gateways").select("id").eq("serial", patch.serial).neq("id", id).maybeSingle();
      if (dupErr) return jsonErrorCompat("Erro ao validar serial.", 500, { code: "db_error", extra: { details: dupErr.message } });
      if (dup) return jsonErrorCompat("Gateway já existe com este serial.", 409, { code: "duplicate_gateway_serial" });
    }

    const { data, error } = await sb
      .from("gateways")
      .update(patch)
      .eq("id", id)
      .select("id,serial,condominio_id,created_at")
      .maybeSingle();

    if (error) return jsonErrorCompat("Erro ao atualizar gateway.", 500, { code: "db_error", extra: { details: error.message } });
    if (!data) return jsonErrorCompat("gateway not found", 404, { code: "gateway_not_found" });

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return jsonErrorCompat("Erro inesperado ao atualizar gateway.", 500, {
      code: "internal_error",
      extra: { details: e?.message ?? String(e) },
    });
  }
}
