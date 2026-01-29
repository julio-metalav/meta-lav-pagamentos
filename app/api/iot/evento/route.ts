export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Se você já tinha esses helpers no arquivo antigo, mantenha este import.
// Se não existir no seu projeto, me avisa que eu ajusto o arquivo.
import { insertEventoFlexible } from "@/lib/eventos";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    // 1) Lê rawBody (tem que ser exatamente o mesmo texto que foi assinado no HMAC)
    const rawBody = await req.text();

    // 2) Auth HMAC
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) {
      return NextResponse.json(auth, { status: 401 });
    }

    const serial = auth.serial;
    const admin = supabaseAdmin();

    // 3) Parse JSON (depois de autenticar)
    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return bad("JSON inválido no body");
    }

    // Campos esperados (flexível)
    const tipo = String(body?.tipo ?? body?.type ?? "").trim();
    if (!tipo) return bad("tipo é obrigatório");

    const maquina_id = body?.maquina_id ?? body?.machine_id ?? body?.condominio_maquinas_id ?? null;
    const payload = body?.payload ?? {};

    // 4) Garante gateway no banco e pega o ID real
    // IMPORTANTÍSSIMO: sua tabela gateways tem condominio_id NOT NULL,
    // então o gateway precisa existir com condominio_id preenchido ANTES.
    // Aqui a gente só atualiza last_seen_at e busca o id.
    const nowIso = new Date().toISOString();

    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .upsert({ serial, last_seen_at: nowIso }, { onConflict: "serial" })
      .select("id, serial, condominio_id")
      .single();

    if (gwErr) return bad(gwErr.message, 500);
    if (!gw?.id) return bad("Gateway não encontrado após upsert", 500);

    // 5) Grava evento (usa gateway_id real do banco)
    const ins = await insertEventoFlexible(admin, {
      gateway_id: gw.id,
      maquina_id,
      condominio_maquinas_id: maquina_id,
      tipo,
      payload,
    });

    if (ins?.error) {
      return bad(ins.error.message ?? "Falha ao inserir evento", 500);
    }

    return NextResponse.json({
      ok: true,
      serial,
      gateway_id: gw.id,
      tipo,
      maquina_id,
    });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
