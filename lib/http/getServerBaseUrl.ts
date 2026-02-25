import { headers } from "next/headers";

/**
 * Base URL para fetch server-side (admin, server actions).
 * Derivada dos headers da request (x-forwarded-host / x-forwarded-proto) para evitar
 * usar VERCEL_URL (deployment URL) que pode retornar "Vercel Authentication Required".
 * Não usa VERCEL_URL em produção.
 */
export async function getServerBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "https").trim().toLowerCase();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";

  if (host && host.length > 0) {
    const scheme = proto === "http" ? "http" : "https";
    return `${scheme}://${host}`;
  }

  const env =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    (process.env.NODE_ENV === "development" ? process.env.VERCEL_URL : null) ||
    "";
  if (!env) return "http://localhost:3000";
  if (env.startsWith("http")) return env;
  return `https://${env}`;
}
