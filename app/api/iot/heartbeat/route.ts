// app/api/iot/heartbeat/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { heartbeatGateway } from "@/lib/iot/service";

export async function POST(req: Request) {
  const result = await heartbeatGateway({ req });
  return NextResponse.json(result.body, { status: result.status });
}
