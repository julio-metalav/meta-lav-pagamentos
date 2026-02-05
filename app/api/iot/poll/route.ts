// app/api/iot/poll/route.ts
import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

/**
 * POLL (PT-BR)
 * - Autentica gateway via HMAC (authenticateGateway)
 * - Lê comandos em iot_commands (status = 'PENDENTE')
 * - Converte condominio_maquinas_id -> identificador_local (machine_id)
 * - Marca comandos como 'ENVIADO' (para não reentregar)
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // 1) Auth HMAC
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) return NextResponse.json(auth, { status: auth.status ?? 401 });

    const serial = auth.serial;

    // 2) Parse JSON body
    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return bad("JSON inválido no body");
    }

    const max = clampInt(body?.max, 1, 20, 1);
    const admin = supabaseAdmin() as any;
    const nowIso = new Date().toISOString();

    // 3) Validar gateway cadastrado e obter ID
    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, serial")
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad(gwErr.message, 500);
    if (!gw) {
      return bad(
        "Gateway não cadastrado. Cadastre o serial em gateways antes de liberar o poll.",
        403
      );
    }

    // 4) Atualiza last_seen_at
    const { error: upErr } = await admin
      .from("gateways")
      .update({ last_seen_at: nowIso })
      .eq("id", gw.id);

    if (upErr) return bad(upErr.message, 500);

    // 5) Busca comandos pendentes (PT-BR)
    const { data: cmds, error: qErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, tipo, payload, expires_at, condominio_maquinas_id, status, created_at")
      .eq("gateway_id", gw.id)
      .eq("status", "PENDENTE")
      .order("created_at", { ascending: true })
      .limit(max);

    if (qErr) return bad(qErr.message, 500);

    const rows = Array.isArray(cmds) ? cmds : [];

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, serial, commands: [], max });
    }

    // 6) Mapear condominio_maquinas_id -> identificador_local (machine_id)
    const maquinaIds = Array.from(
      new Set(rows.map((r: any) => r.condominio_maquinas_id).filter(Boolean))
    );

    const { data: maquinas, error: mErr } = await admin
      .from("condominio_maquinas")
      .select("id, identificador_local")
      .in("id", maquinaIds);

    if (mErr) return bad(mErr.message, 500);

    const mapMachineId = new Map<string, string>();
    (maquinas ?? []).forEach((m: any) => {
      if (m?.id && m?.identificador_local) mapMachineId.set(m.id, m.identificador_local);
    });

    const commands = rows.map((c: any) => ({
      // id é o cmd_id (uuid) — é isso que o ACK deve devolver
      id: c.cmd_id,
      type: c.tipo,
      machine_id: mapMachineId.get(c.condominio_maquinas_id) ?? null,
      payload: c.payload ?? {},
    }));

    // 7) Marcar como ENVIADO (evita reentrega)
    const rowIds = rows.map((r: any) => r.id);
    const { error: uErr } = await admin
      .from("iot_commands")
      .update({ status: "ENVIADO" })
      .in("id", rowIds)
      .eq("gateway_id", gw.id)
      .eq("status", "PENDENTE");

    if (uErr) return bad(uErr.message, 500);

    return NextResponse.json({ ok: true, serial, commands, max });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
