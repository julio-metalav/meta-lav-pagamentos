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

  // JSON válido obrigatório
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const tipo = String(payload?.type ?? "");
  if (!tipo) return json(400, { ok: false, error: "missing_type" });

  const tsGw = Number.parseInt(String(ts), 10);
  if (!Number.isFinite(tsGw)) return json(400, { ok: false, error: "invalid_ts" });

  const admin = supabaseAdmin();

  // 1) grava sempre o evento bruto
  const { data: evento, error: evErr } = await admin
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

  if (evErr || !evento) {
    return json(500, {
      ok: false,
      error: "db_error",
      detail: evErr?.message ?? "insert_event_failed",
    });
  }

  // 2) se for PULSE, cria ciclos derivados
  if (tipo === "PULSE") {
    const pulsesRaw = payload?.payload?.pulses;
    const pulses = Number.parseInt(String(pulsesRaw ?? "1"), 10);

    if (!Number.isFinite(pulses) || pulses <= 0) {
      return json(400, { ok: false, error: "invalid_pulses", evento_id: evento.id });
    }

    // gera N linhas (1 por ciclo). Mantém simples e auditável.
    const rows = Array.from({ length: pulses }, () => ({
      gw_serial: serial,
      ts_gw: tsGw,
      ciclos: 1,
      origem: "PULSE",
      evento_id: evento.id,
    }));

    const { error: cErr } = await admin.from("iot_ciclos").insert(rows);

    if (cErr) {
      return json(500, {
        ok: false,
        error: "db_error",
        detail: cErr.message,
        evento_id: evento.id,
      });
    }

    return json(200, {
      ok: true,
      evento_id: evento.id,
      created_at: evento.created_at,
      ciclos_criados: pulses,
    });
  }

  // BUSY (por enquanto só log)
  return json(200, { ok: true, evento_id: evento.id, created_at: evento.created_at });
}
