// app/api/iot/evento/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyHmac } from "@/lib/libiot-hmac";
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

  // IMPORTANTE: rawBody precisa ser EXATO (mesmos bytes assinados)
  const rawBody = await req.text();

  const { ok: hmacOk, debug } = verifyHmac({
    serial,
    ts,
    receivedHex: sign,
    rawBody,
  });

  if (!hmacOk) {
    const debugOn = process.env.DEBUG_HMAC === "1";

    console.log("[IOT_EVENTO] invalid_hmac", {
      serial: debug.serial,
      serialNorm: debug.serialNorm,
      ts: debug.ts,
      rawBodyLen: debug.rawBodyLen,
      secretSource: debug.secretSource,
      expectedHead: debug.expectedHead,
      receivedHead: debug.receivedHead,
      envHasGeneric: debug.envHasGeneric,
      envHasPerSerial: debug.envHasPerSerial,
      baseHead: debug.baseHead,
      rawBodyHead: debug.rawBodyHead,
    });

    return json(401, {
      ok: false,
      error: "invalid_hmac",
      ...(debugOn ? { debug } : {}),
    });
  }

  // Parse JSON (o gateway deve mandar JSON válido)
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const tipo = String(payload?.type ?? "");
  if (!tipo) {
    return json(400, { ok: false, error: "missing_type" });
  }

  const tsGw = Number.parseInt(String(ts), 10);
  if (!Number.isFinite(tsGw)) {
    return json(400, { ok: false, error: "invalid_ts" });
  }

  // Insere no banco
  try {
    const admin = supabaseAdmin();

    const { data, error } = await admin
      .from("iot_eventos")
      .insert({
        gw_serial: serial,
        ts_gw: tsGw,
        tipo,
        payload,
        raw_body: rawBody,
        hmac_ok: true,
      })
      .select("id, created_at")
      .single();

    if (error) {
      return json(500, { ok: false, error: "db_error", detail: error.message });
    }

    return json(200, { ok: true, id: data.id, created_at: data.created_at });
  } catch (e: any) {
    return json(500, { ok: false, error: "server_error", detail: String(e?.message ?? e) });
  }
}
