// app/api/iot/ack/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ackCommand } from "@/lib/iot/service";

/**
 * ACK (PT-BR)
 * - Auth HMAC via authenticateGateway (mesmo do /poll)
 * - Recebe: { cmd_id, ok, ts, machine_id?, code? ... }
 * - Atualiza iot_commands.status e ack_at
 * - Grava log em iot_acks (opcional, mas útil)
 */
export async function POST(req: Request) {
  const result = await ackCommand({ req });
  return NextResponse.json(result.body, { status: result.status });
}
