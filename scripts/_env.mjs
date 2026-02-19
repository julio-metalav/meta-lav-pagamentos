#!/usr/bin/env node
/**
 * Loader de ambiente para scripts (local | ci | prod).
 * Exige ENV em { local, ci, prod }. Carrega .env.local, .env.ci.local ou .env.prod.local.
 * Uso: import { loadEnv } from "./_env.mjs"; const env = loadEnv();
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const ALLOWED = new Set(["local", "ci", "prod"]);
const DEFAULT_CI_BASE_URL = "https://ci.metalav.com.br";

function getEnvPath(env) {
  if (env === "local") return path.join(ROOT, ".env.local");
  if (env === "ci") return path.join(ROOT, ".env.ci.local");
  if (env === "prod") return path.join(ROOT, ".env.prod.local");
  return path.join(ROOT, ".env.local");
}

/**
 * @param {{ validateFakeGateway?: boolean; gwSerial?: string }} [opts]
 * @returns {{ ENV: string; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; BASE_URL: string; IOT_HMAC_SECRET: string; [k: string]: string }}
 */
export function loadEnv(opts = {}) {
  const raw = process.env.ENV;
  if (!raw || !ALLOWED.has(raw)) {
    throw new Error(
      `ENV é obrigatório e deve ser um de: local, ci, prod. Atual: ${raw ?? "(não definido)"}. Exemplo: ENV=ci node scripts/fake-gateway.mjs`
    );
  }
  const ENV = raw;

  const envPath = getEnvPath(ENV);
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      console.warn(`[env] Aviso ao carregar ${envPath}:`, result.error.message);
    }
  } else {
    console.warn(`[env] Arquivo não encontrado: ${envPath} — usando process.env`);
  }

  const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  let BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
  if (ENV === "ci") {
    if (process.env.BASE_URL_OVERRIDE) {
      BASE_URL = process.env.BASE_URL_OVERRIDE.replace(/\/+$/, "");
    } else if (BASE_URL && BASE_URL !== DEFAULT_CI_BASE_URL) {
      throw new Error(
        `ENV=ci exige BASE_URL=${DEFAULT_CI_BASE_URL}. Use BASE_URL_OVERRIDE para sobrescrever. Atual: BASE_URL=${BASE_URL}`
      );
    } else {
      BASE_URL = BASE_URL || DEFAULT_CI_BASE_URL;
    }
    process.env.BASE_URL = BASE_URL;
  }
  if (ENV === "local" && !BASE_URL) {
    BASE_URL = "http://localhost:3000";
    process.env.BASE_URL = BASE_URL;
  }

  const IOT_HMAC_SECRET = process.env.IOT_HMAC_SECRET || "";

  const SUPABASE_URL_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : "-";

  const env = {
    ENV,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    BASE_URL,
    IOT_HMAC_SECRET,
    SUPABASE_URL_HOST,
  };

  console.log(
    `[env] ENV=${ENV} BASE_URL=${env.BASE_URL || "-"} SUPABASE_URL_HOST=${SUPABASE_URL_HOST}`
  );

  if (opts.validateFakeGateway && opts.gwSerial) {
    const serialNorm = String(opts.gwSerial).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const envKey = `IOT_HMAC_SECRET__${serialNorm}`;
    const secret = process.env[envKey] || process.env.IOT_HMAC_SECRET || "";
    if (!secret) {
      throw new Error(
        `fake-gateway exige secret para o serial. Defina ${envKey} (ou IOT_HMAC_SECRET) no arquivo de env do ambiente (ex: .env.ci.local para ENV=ci).`
      );
    }
  }

  return Object.freeze({ ...env });
}
