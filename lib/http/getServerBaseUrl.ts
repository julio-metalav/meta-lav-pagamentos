import { headers } from "next/headers";

/**
 * Base URL para fetch server-side (admin, server actions).
 * Derivada dos headers da request (x-forwarded-host / x-forwarded-proto) para evitar
 * usar VERCEL_URL (deployment URL) que pode retornar "Vercel Authentication Required".
 * Não usa VERCEL_URL em produção.
 */
export async function getServerBaseUrl(): Promise<string> {
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host");
  const hostHeader = h.get("host");
  const host = (forwardedHost ?? hostHeader ?? "").split(",")[0]?.trim() ?? "";

  const candidates: string[] = [];
  if (host) candidates.push(host);

  if (process.env.NEXT_PUBLIC_BASE_URL?.trim()) {
    candidates.push(process.env.NEXT_PUBLIC_BASE_URL.trim());
  }
  if (process.env.BASE_URL?.trim()) {
    candidates.push(process.env.BASE_URL.trim());
  }
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL_URL?.trim()) {
    candidates.push(process.env.VERCEL_URL.trim());
  }
  if (process.env.NODE_ENV !== "production") {
    candidates.push("localhost:3000");
  }

  for (const candidate of candidates) {
    const withoutProtocol = candidate.replace(/^https?:\/\//i, "").trim();
    if (!withoutProtocol) continue;

    try {
      const baseUrl = `https://${withoutProtocol}`;
      const normalized = new URL("/", baseUrl).origin;
      if (normalized.startsWith("https://")) {
        return normalized;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "Nao foi possivel derivar uma baseUrl valida para o servidor (https://). Defina BASE_URL ou NEXT_PUBLIC_BASE_URL corretamente.",
  );
}
