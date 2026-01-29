export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // 1) Auth HMAC (mesmo padrão do /poll)
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) {
      return NextResponse.json(auth, { status: 401 });
    }
    const serial = auth.serial;

    // 2) Parse JSON
    let data: any;
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

    const admin = supabaseAdmin();
    const nowIso = new Date().toISOString();
    const createdAtIso = new Date(ts * 1000).toISOString();

    // 3) Descobre o "cmd" (type) a partir do gateway_commands
    const { data: cmdRow, error: cmdErr } = await admin
      .from("gateway_commands")
      .select("id, type, status")
      .eq("id", cmdId)
      .eq("gateway_serial", serial)
      .maybeSingle();

    if (cmdErr) return bad("db_error", 500, { detail: cmdErr.message });
    if (!cmdRow) return bad("cmd_not_found", 404);

    const cmd = String(cmdRow.type ?? "UNKNOWN");

    // 4) Grava ACK no schema REAL (serial, cmd_id, cmd, ...)
    const { error: ackErr } = await admin.from("iot_acks").insert({
      serial,
      machine_id: machineId,
      cmd_id: cmdId,
      cmd,
      ok,
      code: code ?? null,
      payload: data,
      created_at: createdAtIso,
    });

    if (ackErr) {
      return bad("db_error", 500, { detail: ackErr.message });
    }

    // 5) Dá baixa no comando: sent -> acked/failed
    const newStatus = ok ? "acked" : "failed";

    // Atualiza só campos que sabemos que existem com certeza: status.
    // (sent_at existe; acked_at pode não existir — então não usamos aqui.)
    const { error: upErr } = await admin
      .from("gateway_commands")
      .update({ status: newStatus })
      .eq("id", cmdId)
      .eq("gateway_serial", serial);

    if (upErr) return bad("db_error", 500, { detail: upErr.message });

    // 6) Atualiza last_seen_at no gateway (opcional, mas útil)
    await admin.from("gateways").update({ last_seen_at: nowIso }).eq("serial", serial);

    return NextResponse.json({ ok: true, serial, cmd_id: cmdId, status: newStatus });
  } catch (e: any) {
    return bad("internal_error", 500, { detail: String(e?.message ?? e) });
  }
}
