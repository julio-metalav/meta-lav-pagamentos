export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { compensationAlert } from "@/lib/payments/compensation";

export async function POST(req: Request) {
  const result = await compensationAlert(req);
  return NextResponse.json(result.body, { status: result.status });
}
