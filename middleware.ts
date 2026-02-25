import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "admin_session";

function b64UrlToB64(input: string) {
  return input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyAdminSessionEdge(token: string, secret: string) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return { ok: false as const };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = bytesToB64Url(mac);
  if (expected !== sig) return { ok: false as const };

  let payload: any = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64ToBytes(b64UrlToB64(body))));
  } catch {
    return { ok: false as const };
  }

  const exp = Number(payload?.exp || 0);
  const userId = String(payload?.user_id || "");
  if (!userId || !Number.isFinite(exp)) return { ok: false as const };
  if (Date.now() > exp) return { ok: false as const };

  return { ok: true as const, userId, exp };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (!isAdminPage && !isAdminApi) return NextResponse.next();

  // allow login/activate/reset endpoints/pages
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/admin/activate") || pathname.startsWith("/admin/reset")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    return new NextResponse("Admin auth not configured", { status: 500 });
  }

  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  const v = await verifyAdminSessionEdge(token, secret);

  if (v.ok) return NextResponse.next();

  if (isAdminApi) return new NextResponse("Unauthorized", { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
