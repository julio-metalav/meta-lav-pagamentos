// app/api/iot/evento/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { recordEvento } from "@/lib/iot/service";

/**
 * EVENTO (PT-BR)
 * - Auth HMAC
 * - Registra evento em eventos_iot
 * - Mantém compatibilidade com logs legados
 */
export async function POST(req: Request) {
  const result = await recordEvento({ req });
  return NextResponse.json(result.body, { status: result.status });
}
