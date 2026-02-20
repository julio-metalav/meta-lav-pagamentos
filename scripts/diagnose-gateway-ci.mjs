#!/usr/bin/env node
/**
 * Diagnóstico somente leitura: gateway GW-TESTE-001 + máquinas + iot_commands.
 * Uso: ENV=ci node scripts/diagnose-gateway-ci.mjs  (ou ENV=local)
 * Regra: só SELECT. Não faz UPDATE/INSERT.
 */

import { loadEnv } from "./_env.mjs";
import { createClient } from "@supabase/supabase-js";

const SERIAL = "GW-TESTE-001";

async function main() {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios.");
    process.exit(1);
  }

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("\n--- 1) Gateways com serial =", SERIAL, "---");
  const { data: gw, error: gwErr } = await sb
    .from("gateways")
    .select("id, serial, condominio_id, last_seen_at, created_at")
    .eq("serial", SERIAL)
    .maybeSingle();

  if (gwErr) {
    console.error("Erro:", gwErr.message);
    process.exit(1);
  }
  if (!gw) {
    console.log("Resultado: nenhum registro.");
    console.log("\n>>> CENÁRIO: (A) gateway não existe");
    return;
  }
  console.log(JSON.stringify(gw, null, 2));
  const gatewayId = gw.id;

  console.log("\n--- 2) condominio_maquinas onde gateway_id =", gatewayId, "---");
  const { data: maquinas, error: maqErr } = await sb
    .from("condominio_maquinas")
    .select("id, condominio_id, identificador_local, ativa, tipo, updated_at")
    .eq("gateway_id", gatewayId);

  if (maqErr) {
    console.error("Erro:", maqErr.message);
    process.exit(1);
  }
  console.log("Total:", maquinas?.length ?? 0);
  if (maquinas?.length) console.log(JSON.stringify(maquinas, null, 2));

  if (!maquinas?.length) {
    console.log("\n>>> CENÁRIO: (B) gateway existe, mas nenhuma máquina aponta pra ele");
    return;
  }

  console.log("\n--- 3) Últimos 30 iot_commands onde gateway_id =", gatewayId, "---");
  const { data: cmds, error: cmdErr } = await sb
    .from("iot_commands")
    .select("id, cmd_id, tipo, status, condominio_maquinas_id, pagamento_id, created_at, ack_at")
    .eq("gateway_id", gatewayId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (cmdErr) {
    console.error("Erro:", cmdErr.message);
    process.exit(1);
  }
  console.log("Total (últimos 30):", cmds?.length ?? 0);
  if (cmds?.length) console.log(JSON.stringify(cmds, null, 2));

  const { count, error: countErr } = await sb
    .from("iot_commands")
    .select("id", { count: "exact", head: true })
    .eq("gateway_id", gatewayId)
    .eq("status", "PENDENTE")
    .is("ack_at", null);

  if (countErr) {
    console.error("Erro ao contar PENDENTE/ack_at IS NULL:", countErr.message);
  } else {
    console.log("\n--- Contagem: status='PENDENTE' AND ack_at IS NULL ---");
    console.log("Total:", count ?? 0);
  }

  const pendenteSemAck = Number(count ?? 0);
  if (pendenteSemAck > 0) {
    console.log("\n>>> CENÁRIO: (D) tem pendente sem ack (poll/fake-gateway/backend)");
    return;
  }
  console.log("\n>>> CENÁRIO: (C) gateway/máquina ok, mas não tem iot_command pendente (execute-cycle não chamado ou falhando)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
