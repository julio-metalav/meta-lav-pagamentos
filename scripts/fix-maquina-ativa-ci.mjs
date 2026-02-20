#!/usr/bin/env node
/**
 * One-off: UPDATE condominio_maquinas SET ativa=true para máquina LAV-01 no CI.
 * Uso: ENV=ci node scripts/fix-maquina-ativa-ci.mjs
 */

import { loadEnv } from "./_env.mjs";
import { createClient } from "@supabase/supabase-js";

const MAQUINA_ID = "a6be925b-ed54-444c-b607-02695d1651dc";

async function main() {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios.");
    process.exit(1);
  }

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("\n--- UPDATE condominio_maquinas SET ativa=true, updated_at=now() WHERE id =", MAQUINA_ID, "---");
  const { data: updated, error: upErr } = await sb
    .from("condominio_maquinas")
    .update({ ativa: true, updated_at: new Date().toISOString() })
    .eq("id", MAQUINA_ID)
    .select("id, identificador_local, ativa, updated_at")
    .maybeSingle();

  if (upErr) {
    console.error("Erro no UPDATE:", upErr.message);
    process.exit(1);
  }
  if (!updated) {
    console.error("Nenhuma linha atualizada (id não encontrado?).");
    process.exit(1);
  }
  console.log("OK. Linha atualizada:", JSON.stringify(updated, null, 2));

  console.log("\n--- SELECT de confirmação ---");
  const { data: row, error: selErr } = await sb
    .from("condominio_maquinas")
    .select("id, identificador_local, ativa, gateway_id, updated_at")
    .eq("id", MAQUINA_ID)
    .maybeSingle();

  if (selErr) {
    console.error("Erro no SELECT:", selErr.message);
    process.exit(1);
  }
  console.log(JSON.stringify(row, null, 2));
  if (row?.ativa === true) {
    console.log("\nConfirmado: ativa=true. Pode repetir o fluxo no Samsung.");
  } else {
    console.log("\nAviso: ativa não está true após SELECT.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
