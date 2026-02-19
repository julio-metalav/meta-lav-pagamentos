#!/usr/bin/env node
/**
 * Script temporário para backfill de kits_operacionais
 *
 * Busca todos os pos_devices e cria kits operacionais,
 * vinculando máquinas aos kits através de kit_id.
 *
 * Uso: ENV=local node scripts/backfill_kits.js
 */

const path = require("path");
const ENV = process.env.ENV;
if (!ENV || !["local", "ci", "prod"].includes(ENV)) {
  console.error("ENV é obrigatório: local, ci ou prod. Ex: ENV=local node scripts/backfill_kits.js");
  process.exit(1);
}
const envFile = ENV === "local" ? ".env.local" : ENV === "ci" ? ".env.ci.local" : ".env.prod.local";
require("dotenv").config({ path: path.join(process.cwd(), envFile) });
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function supabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    mustEnv("SUPABASE_URL");

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const sb = supabaseAdmin();
  let kitsCriados = 0;
  let maquinasAtualizadas = 0;

  console.log("[backfill_kits] Iniciando backfill de kits operacionais...\n");

  // 1) Buscar todos os pos_devices
  const { data: posDevices, error: posErr } = await sb
    .from("pos_devices")
    .select("id, serial, condominio_id")
    .order("created_at", { ascending: true });

  if (posErr) {
    console.error("[backfill_kits] Erro ao buscar pos_devices:", posErr.message);
    process.exit(1);
  }

  if (!posDevices || posDevices.length === 0) {
    console.log("[backfill_kits] Nenhum POS encontrado. Encerrando.");
    process.exit(0);
  }

  console.log(`[backfill_kits] Encontrados ${posDevices.length} POS devices\n`);

  // 2) Para cada POS, criar kit e atualizar máquinas
  for (const pos of posDevices) {
    try {
      console.log(`[backfill_kits] Processando POS: ${pos.serial} (${pos.id})`);

      // Buscar gateway do mesmo condomínio (mais antigo primeiro)
      const { data: gateways, error: gwErr } = await sb
        .from("gateways")
        .select("id")
        .eq("condominio_id", pos.condominio_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (gwErr) {
        console.error(`[backfill_kits] Erro ao buscar gateway para POS ${pos.serial}:`, gwErr.message);
        continue;
      }

      if (!gateways || gateways.length === 0) {
        console.warn(`[backfill_kits] Nenhum gateway encontrado para condomínio ${pos.condominio_id}. Pulando POS ${pos.serial}.`);
        continue;
      }

      const gatewayId = gateways[0].id;

      // Verificar se kit já existe para este POS
      const { data: existingKit, error: existingKitErr } = await sb
        .from("kits_operacionais")
        .select("id")
        .eq("pos_device_id", pos.id)
        .maybeSingle();

      if (existingKitErr) {
        console.error(`[backfill_kits] Erro ao verificar kit existente para POS ${pos.serial}:`, existingKitErr.message);
        continue;
      }

      let kitId;

      if (existingKit) {
        // Kit já existe, usar o existente
        kitId = existingKit.id;
        console.log(`[backfill_kits] Kit existente encontrado: ${kitId}`);
      } else {
        // Criar kit operacional
        const nomeKit = `AUTO-${pos.serial}`;
        const { data: kit, error: kitErr } = await sb
          .from("kits_operacionais")
          .insert({
            nome_kit: nomeKit,
            condominio_id: pos.condominio_id,
            pos_device_id: pos.id,
            gateway_id: gatewayId,
            ativo: true,
          })
          .select("id")
          .single();

        if (kitErr) {
          console.error(`[backfill_kits] Erro ao criar kit para POS ${pos.serial}:`, kitErr.message);
          continue;
        }

        if (!kit || !kit.id) {
          console.error(`[backfill_kits] Kit criado mas sem ID para POS ${pos.serial}`);
          continue;
        }

        kitId = kit.id;
        kitsCriados++;
        console.log(`[backfill_kits] Kit criado: ${kitId}`);
      }

      // Atualizar máquinas vinculadas a este POS
      const { data: updatedMachines, error: updateErr } = await sb
        .from("condominio_maquinas")
        .update({ kit_id: kitId })
        .eq("pos_device_id", pos.id)
        .is("kit_id", null)
        .select("id");

      if (updateErr) {
        console.error(`[backfill_kits] Erro ao atualizar máquinas para POS ${pos.serial}:`, updateErr.message);
      } else {
        const count = updatedMachines?.length || 0;
        maquinasAtualizadas += count;
        console.log(`[backfill_kits] ${count} máquina(s) atualizada(s) para POS ${pos.serial}`);
      }

      console.log("");
    } catch (err) {
      console.error(`[backfill_kits] Erro ao processar POS ${pos.serial}:`, err.message);
      continue;
    }
  }

  // Resumo final
  console.log("\n" + "=".repeat(60));
  console.log("[backfill_kits] RESUMO FINAL:");
  console.log("=".repeat(60));
  console.log(`Total de kits criados: ${kitsCriados}`);
  console.log(`Total de máquinas atualizadas: ${maquinasAtualizadas}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("[backfill_kits] Erro fatal:", err);
  process.exit(1);
});
