// app/api/iot/poll/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

function toInt(v: string | null, fallback: number) {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * POLL (PT-BR)
 * - Produção: Auth HMAC via authenticateGateway (serial do gateway)
 * - Dev (somente fora de produção): permite gateway_id via querystring (sem HMAC)
 *
 * Retorna comandos iot_commands com status='pendente' e ack_at IS NULL
 * Ao retornar, marca os comandos como ENVIADO (idempotência via status/ids)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(toInt(url.searchParams.get("limit"), 5), 1), 20);
    const nowIso = new Date().toISOString();

    const admin = supabaseAdmin() as any;

    let gatewayId: string | null = null;
    let serial: string | null = null;

    // ===== 1) Produção: HMAC =====
    // Se vier headers HMAC, autentica e resolve gateway_id via serial
    // (mesmo padrão do /ack)
    const rawBody = ""; // GET não tem body
    const auth = authenticateGateway(req as any, rawBody);

    if (auth.ok) {
      serial = auth.serial;

      const { data: gw, error: gwErr } = await admin
        .from("gateways")
        .select("id, serial")
        .eq("serial", serial)
        .maybeSingle();

      if (gwErr) return bad("db_error", 500, { detail: gwErr.message });
      if (!gw) return bad("gateway_not_found", 404);

      gatewayId = gw.id;
    } else {
      // ===== 2) Dev fallback (somente fora de produção) =====
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(auth, { status: auth.status ?? 401 });
      }

      gatewayId = url.searchParams.get("gateway_id");
      if (!gatewayId) return bad("missing_gateway_id", 400, { detail: "Em dev, informe gateway_id" });

      // tenta resolver serial só pra resposta/debug (best effort)
      try {
        const { data: gw } = await admin
          .from("gateways")
          .select("id, serial")
          .eq("id", gatewayId)
          .maybeSingle();
        if (gw?.serial) serial = gw.serial;
      } catch {}
    }

    // ===== 3) Buscar comandos pendentes =====
    const { data: cmds, error: cmdErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, tipo, payload, status, expires_at, created_at")
      .eq("gateway_id", gatewayId)
      .in("status", ["pendente", "PENDENTE"])
      .is("ack_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (cmdErr) return bad("db_error", 500, { detail: cmdErr.message });

    const list = cmds ?? [];

    // ===== 4) Marcar como ENVIADO (idempotente) =====
    // Marca só os ids que vamos devolver; evita reentrega infinita.
    if (list.length > 0) {
      const ids = list.map((c: any) => c.id);
      const { error: upErr } = await admin
        .from("iot_commands")
        .update({ status: "ENVIADO" })
        .in("id", ids)
        .eq("gateway_id", gatewayId)
        .in("status", ["pendente", "PENDENTE"]);

      if (upErr) return bad("db_error", 500, { detail: upErr.message });
    }

    // ===== 5) Atualiza last_seen_at (best effort) =====
    try {
      await admin.from("gateways").update({ last_seen_at: nowIso }).eq("id", gatewayId);
    } catch {}

    return NextResponse.json({
      ok: true,
      gateway_id: gatewayId,
      serial,
      debug_count: list.length,
      debug_first: list[0] ?? null,
      commands: list.map((c: any) => ({
        id: c.id,
        cmd_id: c.cmd_id,
        tipo: c.tipo,
        payload: c.payload,
        expires_at: c.expires_at,
        created_at: c.created_at,
      })),
    });
  } catch (e: any) {
    return bad("internal_error", 500, { detail: String(e?.message ?? e) });
  }
}
