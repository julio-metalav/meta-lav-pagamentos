#!/usr/bin/env node

import { loadEnv } from "./_env.mjs";
import { createClient } from "@supabase/supabase-js";

const env = loadEnv();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("ERRO: faltou SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const LIMIT = Number(process.env.ALERTS_OUTBOX_DISPATCH_LIMIT || 20);
const MAX_ATTEMPTS = Number(process.env.ALERTS_OUTBOX_MAX_ATTEMPTS || 10);

async function main() {
  const { data: rows, error } = await sb
    .from("alert_outbox")
    .select("id,event_code,severity,fingerprint,channel,target,text,status,attempts")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  if (error) {
    console.error("ERRO: query outbox:", error.message);
    process.exit(1);
  }

  let sent = 0;
  let failed = 0;

  for (const r of rows || []) {
    const nextAttempts = Number(r.attempts || 0) + 1;
    if (nextAttempts > MAX_ATTEMPTS) {
      await sb.from("alert_outbox").update({ status: "dead", attempts: nextAttempts, last_error: "max_attempts" }).eq("id", r.id);
      failed++;
      continue;
    }

    // Mark sending (best-effort)
    await sb.from("alert_outbox").update({ status: "sending", attempts: nextAttempts }).eq("id", r.id).in("status", ["pending", "failed"]);

    // NOTE: This script only enqueues send requests by printing JSONL to stdout.
    // The OpenClaw cron runner (agent) should do the actual send via message tool.
    // We keep this script as a DB helper for local debugging.

    // We can't send from here without OpenClaw tools.
    // So we mark back to pending and let cron-agent handle actual send.
    await sb.from("alert_outbox").update({ status: "pending" }).eq("id", r.id);
  }

  console.log(JSON.stringify({ ok: true, scanned: (rows || []).length, sent, failed }));
}

main().catch((e) => {
  console.error("ERRO:", e?.message || String(e));
  process.exit(1);
});
