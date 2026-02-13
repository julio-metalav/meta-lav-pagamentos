export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAppUser } from "@/lib/app/auth";

export async function GET(req: Request) {
  try {
    const sb = supabaseAdmin() as any;
    const auth = await getAppUser(req, sb);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    return NextResponse.json({ ok: true, user: auth.user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
