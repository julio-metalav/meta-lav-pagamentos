export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURS_MIN = 1;
const HOURS_MAX = 168;
const HOURS_DEFAULT = 24;

function parseUuid(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!UUID_REGEX.test(trimmed)) {
    throw jsonErrorCompat("UUID inválido.", 400, { code: "invalid_uuid" });
  }
  return trimmed;
}

function parseHours(value: string | null) {
  if (!value) return HOURS_DEFAULT;
  const num = Number(value);
  if (!Number.isFinite(num)) throw jsonErrorCompat("hours inválido.", 400, { code: "invalid_hours" });
  const clamped = Math.min(HOURS_MAX, Math.max(HOURS_MIN, Math.floor(num)));
  return clamped;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const hours = parseHours(url.searchParams.get("hours"));
    const condominioId = parseUuid(url.searchParams.get("condominio_id"));
    const gatewayId = parseUuid(url.searchParams.get("gateway_id"));

    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("rpc_dashboard0", {
      p_inicio: start.toISOString(),
      p_fim: end.toISOString(),
      p_condominio_id: condominioId,
      p_gateway_id: gatewayId,
    });

    if (error) {
      const msg = error.message || "rpc error";
      if (msg.toLowerCase().includes("rpc_dashboard0")) {
        return jsonErrorCompat("RPC não configurada.", 501, {
          code: "RPC_NOT_FOUND",
          extra: { hint: "Crie rpc_dashboard0 no Supabase SQL Editor" },
        });
      }
      return jsonErrorCompat("Erro ao executar rpc_dashboard0.", 500, {
        code: "rpc_error",
        extra: { details: msg },
      });
    }

    if (!data || typeof data !== "object") {
      return jsonErrorCompat("Resposta inválida da RPC.", 502, { code: "invalid_rpc_response" });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : String(err);
    return jsonErrorCompat("Erro inesperado no dashboard0.", 500, {
      code: "internal_error",
      extra: { details: msg },
    });
  }
}
