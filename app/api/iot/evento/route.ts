export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    // 1) rawBody precisa ser exatamente o mesmo texto assinado no HMAC
    const rawBody = await req.text();

    // 2) Auth HMAC
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) return NextResponse.json(auth, { status: 401 });

    const serial = auth.serial;
    const admin = supabaseAdmin();

    // 3) Parse JSON (depois de autenticar)
    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return bad("JSON inválido no body");
    }

    const tipo = String(body?.tipo ?? body?.type ?? "").trim();
    if (!tipo) return bad("tipo é obrigatório");

    const maquina_id =
      body?.maquina_id ?? body?.machine_id ?? body?.condominio_maquinas_id ?? null;

    const payload = body?.payload ?? {};

    // 4) Confirma que o gateway já existe (NÃO tenta criar aqui, porque condominio_id é NOT NULL)
    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, serial, condominio_id")
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad(gwErr.message, 500);

    if (!gw?.id) {
      return bad(
        `Gateway '${serial}' não cadastrado. Cadastre em 'gateways' com condominio_id antes de enviar eventos.`,
        409
      );
    }

    // 5) Por enquanto, NÃO grava evento (evita chutar tabela/colunas).
    //    Esse endpoint fica "aceitando" eventos para destravar o deploy.
    return NextResponse.json({
      ok: true,
      serial,
      gateway_id: gw.id,
      condominio_id: gw.condominio_id,
      tipo,
      maquina_id,
      payload,
      stored: false,
    });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
