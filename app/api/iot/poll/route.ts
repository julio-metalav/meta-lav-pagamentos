export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // 1) Auth HMAC
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) {
      return NextResponse.json(auth, { status: 401 });
    }
    const serial = auth.serial;

    // 2) Parse JSON body
    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return bad("JSON inválido no body");
    }

    const max = clampInt(body?.max, 1, 20, 1);

    const admin = supabaseAdmin();
    const nowIso = new Date().toISOString();

    // 3) NÃO cria gateway aqui (porque seu schema exige condominio_id NOT NULL)
    //    Apenas valida que ele já existe cadastrado.
    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("serial")
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad(gwErr.message, 500);

    if (!gw) {
      // 403 para deixar claro: autentica ok, mas não está habilitado/cadastrado
      return bad(
        "Gateway não cadastrado (falta vínculo com condomínio). Cadastre o serial no banco antes de liberar o poll.",
        403
      );
    }

    // 4) Atualiza last_seen_at (agora sim, sem mexer em condominio_id)
    const { error: upErr } = await admin
      .from("gateways")
      .update({ last_seen_at: nowIso })
      .eq("serial", serial);

    if (upErr) return bad(upErr.message, 500);

    // 5) Busca comandos pending
    const { data: cmds, error: qerr } = await admin
      .from("gateway_commands")
      .select("id, type, payload, created_at, status")
      .eq("gateway_serial", serial)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(max);

    if (qerr) return bad(qerr.message, 500);

    const commands = (cmds ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      payload: c.payload ?? {},
    }));

    // 6) Marca como sent
    if (commands.length > 0) {
      const ids = commands.map((c) => c.id);
      const { error: uerr } = await admin
        .from("gateway_commands")
        .update({ status: "sent", sent_at: nowIso })
        .in("id", ids)
        .eq("gateway_serial", serial);

      if (uerr) return bad(uerr.message, 500);
    }

    return NextResponse.json({
      ok: true,
      serial,
      commands,
      max,
    });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
