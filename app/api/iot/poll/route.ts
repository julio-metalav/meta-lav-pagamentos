// app/api/iot/poll/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pollCommands } from "@/lib/iot/service";

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
  const url = new URL(req.url);
  const limit = Math.min(Math.max(toInt(url.searchParams.get("limit"), 5), 1), 20);

  const result = await pollCommands({ req, limit });
  return NextResponse.json(result.body, { status: result.status });
}
