export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
