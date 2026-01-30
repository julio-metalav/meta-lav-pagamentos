// app/api/iot/heartbeat/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const serial = req.headers.get("x-gw-serial") || "";
  const ts = req.headers.get("x-gw-ts") || "";
  const sign = req.headers.get("x-gw-sign") || "";

  if (!serial || !ts || !sign) {
    return json(400, { ok: false, error: "headers_missing" });
  }

  const rawBody = await req.text();

  const auth = authenticateGateway(req, rawBody);
  if (!auth.ok) {
    return json(401, { ok: false, error: "invalid_hmac" });
  }

  // payload opcional (não exigimos nada, só aceitamos JSON se vier)
  let payload: any = null;
  if (rawBody && rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }
  }

  // Atualiza last_seen_at do gateway (best-effort)
  try {
    const admin = supabaseAdmin();
    await admin
      .from("gateways")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("serial", auth.serial);
  } catch {
    // não quebra heartbeat por falha de update
  }

  return json(200, {
    ok: true,
    serial: auth.serial,
    ts: Number.parseInt(ts, 10),
    payload,
  });
}
