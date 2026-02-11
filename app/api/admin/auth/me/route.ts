export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { jsonErrorCompat } from "@/lib/api/errors";
import { requireAdminSession, getAdminPermissions } from "@/lib/admin/server";

export async function GET() {
  const sess = await requireAdminSession();
  if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });

  const perms = await getAdminPermissions(sess.user.id);

  return NextResponse.json({
    ok: true,
    user: { id: sess.user.id, email: sess.user.email },
    permissions: Array.from(perms.values()).sort(),
  });
}
