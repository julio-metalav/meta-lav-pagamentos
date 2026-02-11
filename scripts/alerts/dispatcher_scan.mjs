#!/usr/bin/env node

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: new URL("../../.env.local", import.meta.url).pathname, quiet: true });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log(JSON.stringify({ ok: false, error: "missing_supabase_env" }));
  process.exit(2);
}

const sb = createClient(url, key);

const limit = Math.min(50, Math.max(1, Number(process.env.ALERTS_OUTBOX_DISPATCH_LIMIT || 20)));
const maxAttempts = Math.min(50, Math.max(1, Number(process.env.ALERTS_OUTBOX_MAX_ATTEMPTS || 10)));

async function main() {
  const { data: rows, error } = await sb
    .from("alert_outbox")
    .select("id,event_code,severity,fingerprint,channel,target,text,status,attempts")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.log(JSON.stringify({ ok: false, error: "db_query_failed", details: error.message }));
    process.exit(1);
  }

  const picked = [];

  for (const r of rows || []) {
    const nextAttempts = Number(r.attempts || 0) + 1;
    if (nextAttempts > maxAttempts) {
      await sb
        .from("alert_outbox")
        .update({ status: "dead", attempts: nextAttempts, last_error: "max_attempts" })
        .eq("id", r.id)
        .in("status", ["pending", "failed"]);
      continue;
    }

    const { error: upErr } = await sb
      .from("alert_outbox")
      .update({ status: "sending", attempts: nextAttempts })
      .eq("id", r.id)
      .in("status", ["pending", "failed"]);

    if (upErr) continue;

    picked.push({
      id: r.id,
      event_code: r.event_code,
      severity: r.severity,
      fingerprint: r.fingerprint,
      channel: r.channel,
      target: r.target,
      text: r.text,
    });
  }

  console.log(JSON.stringify({ ok: true, scanned: (rows || []).length, picked }));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: "internal", details: e?.message || String(e) }));
  process.exit(1);
});
