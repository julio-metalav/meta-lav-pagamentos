export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { enqueueDevCommand } from "@/lib/dev/enqueue";

export async function POST(req: Request) {
  const result = await enqueueDevCommand(req);
  return NextResponse.json(result.body, { status: result.status });
}
