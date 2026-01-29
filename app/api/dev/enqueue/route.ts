export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function mustDev(req: Request) {
  // Trava em produção
  if (process.env.NODE_ENV === "production") return false;

  // Se você setar DEV_ENQUEUE_SECRET, exige header
  const secret = process.env.DEV_ENQUEUE_SECRET;
  if (!secret) return true;

  const got = req.headers.get("x-dev-secret") || "";
  return got === secret;
}

export async function POST(req: Request) {
  try {
    if (!mustDev(req)) return bad("Não autorizado", 401);

    const body = await req.json().catch(() => ({}));
    const serial = String(body.serial || "").trim();
    const type = String(body.type || "PULSE").trim();
    const payload = body.payload ?? { pulses: 1 };

    if (!serial) return bad("serial é obrigatório");

    const admin = supabaseAdmin();

    // garante gateway existe
    const nowIso = new Date().toISOString();
    await admin
      .from("gateways")
      .upsert({ serial, last_seen_at: nowIso }, { onConflict: "serial" });

    const { data, error } = await admin
      .from("gateway_commands")
      .insert({
        gateway_serial: serial,
        type,
        payload,
        status: "pending",
      })
      .select("id, gateway_serial, type, payload, status, created_at")
      .single();

    if (error) return bad(error.message, 500);

    return NextResponse.json({ ok: true, queued: data });
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
