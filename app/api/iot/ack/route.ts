// app/api/iot/ack/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

/**
 * ACK (PT-BR)
 * - Auth HMAC via authenticateGateway (mesmo do /poll)
 * - Recebe: { cmd_id, ok, ts, machine_id?, code? ... }
 * - Atualiza iot_commands.status e ack_at
 * - Grava log em iot_acks (opcional, mas útil)
 *
 * Status:
 * - ENVIADO -> (ok ? ACK : FALHOU)
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // 1) Auth HMAC (mesmo padrão do /poll)
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) return NextResponse.json(auth, { status: auth.status ?? 401 });

    const serial = auth.serial;

    // 2) Parse JSON
    let data: any = {};
    try {
      data = JSON.parse(rawBody || "{}");
    } catch {
      return bad("invalid_json");
    }

    const cmdId = String(data?.cmd_id ?? "");
    const ok = data?.ok;
    const ts = Number.parseInt(String(data?.ts ?? ""), 10);

    if (!cmdId) return bad("invalid_payload", 400, { detail: "cmd_id obrigatório" });
    if (typeof ok !== "boolean") return bad("invalid_payload", 400, { detail: "ok deve ser boolean" });
    if (!Number.isFinite(ts)) return bad("invalid_payload", 400, { detail: "ts inválido" });

    const machineId = data?.machine_id ? String(data.machine_id) : null;
    const code = data?.code ? String(data.code) : null;

    const admin = supabaseAdmin() as any;
    const nowIso = new Date().toISOString();
    const createdAtIso = new Date(ts * 1000).toISOString();

    // 3) Carrega gateway por serial (pra obter gateway_id)
    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, serial")
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad("db_error", 500, { detail: gwErr.message });
    if (!gw) return bad("gateway_not_found", 404);

    // 4) Busca comando real no schema PT-BR (iot_commands) via cmd_id
    const { data: cmdRow, error: cmdErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, tipo, status, condominio_maquinas_id")
      .eq("gateway_id", gw.id)
      .eq("cmd_id", cmdId)
      .maybeSingle();

    if (cmdErr) return bad("db_error", 500, { detail: cmdErr.message });
    if (!cmdRow) return bad("cmd_not_found", 404);

    const cmdTipo = String(cmdRow.tipo ?? "UNKNOWN");

    // 5) Log do ACK (mantém compatibilidade com seu histórico)
    const { error: ackErr } = await admin.from("iot_acks").insert({
      serial,
      machine_id: machineId,
      cmd_id: cmdId,
      cmd: cmdTipo,
      ok,
      code: code ?? null,
      payload: data,
      created_at: createdAtIso,
    });

    if (ackErr) return bad("db_error", 500, { detail: ackErr.message });

    // 6) Atualiza status do comando PT-BR
    const newStatus = ok ? "ACK" : "FALHOU";

    const { error: upErr } = await admin
      .from("iot_commands")
      .update({ status: newStatus, ack_at: nowIso })
      .eq("id", cmdRow.id)
      .eq("gateway_id", gw.id);

    if (upErr) return bad("db_error", 500, { detail: upErr.message });

    // 7) Atualiza last_seen_at do gateway (opcional)
    await admin.from("gateways").update({ last_seen_at: nowIso }).eq("id", gw.id);

    return NextResponse.json({ ok: true, serial, cmd_id: cmdId, status: newStatus });
  } catch (e: any) {
    return bad("internal_error", 500, { detail: String(e?.message ?? e) });
  }
}
