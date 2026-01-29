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
    const rawBody = await req.text();

    // 1) Auth HMAC
    const auth = authenticateGateway(req, rawBody);
    if (!auth.ok) {
      return NextResponse.json(auth, { status: 401 });
    }
    const serial = auth.serial;

    // 2) Parse JSON
    let body: any;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      return bad("JSON inválido no body");
    }

    const commandId = String(body.commandId || "").trim();
    const status = String(body.status || "").trim(); // ok | error
    const detail = body.detail ?? null;

    if (!commandId) return bad("commandId é obrigatório");
    if (!status) return bad("status é obrigatório (ex: ok/error)");

    const admin = supabaseAdmin();

    // 3) Atualiza comando (somente do próprio gateway)
    const { data: updated, error } = await admin
      .from("gateway_commands")
      .update({
        status: "acked",
        acked_at: new Date().toISOString(),
        result: { status, detail },
      })
      .eq("id", commandId)
      .eq("gateway_serial", serial)
      .select("id, type, payload, status, acked_at")
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!updated) return bad("Comando não encontrado para este gateway", 404);

    // 4) Atualiza last_seen (sem last_ip por enquanto)
    const nowIso = new Date().toISOString();
    await admin.from("gateways").upsert({ serial, last_seen_at: nowIso }, { onConflict: "serial" });

    return NextResponse.json({ ok: true, serial, acked: updated });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
