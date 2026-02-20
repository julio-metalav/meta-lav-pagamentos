import { NextResponse } from "next/server";

/**
 * Expõe metadados do deploy (commit, env, url) para provar qual build está no ar.
 * GET /api/_meta
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    vercel_git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    vercel_url: process.env.VERCEL_URL ?? null,
  });
}
