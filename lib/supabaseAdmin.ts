import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Cliente Supabase ADMIN (service role) para o projeto Pagamentos.
 * Use apenas no server (rotas /api), nunca no client.
 */
export function supabaseAdmin() {
  // Aceita tanto nomes "SUPABASE_*" quanto "NEXT_PUBLIC_SUPABASE_URL"
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    mustEnv("SUPABASE_URL");

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
