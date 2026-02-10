export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { compensationStatus } from "@/lib/payments/compensation";

export async function POST(req: Request) {
  const result = await compensationStatus(req);
  return NextResponse.json(result.body, { status: result.status });
}
