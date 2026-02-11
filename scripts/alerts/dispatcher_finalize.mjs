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

function readJsonArg() {
  const idx = process.argv.indexOf("--results");
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const results = readJsonArg();
  if (!results || !Array.isArray(results.items)) {
    console.log(JSON.stringify({ ok: false, error: "missing_results" }));
    process.exit(2);
  }

  let sent = 0;
  let failed = 0;

  for (const it of results.items) {
    const ok = !!it.ok;
    const id = String(it.id || "");
    if (!id) continue;

    if (ok) {
      sent += 1;
      await sb
        .from("alert_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", id)
        .eq("status", "sending");

      await sb.from("alert_dispatch_log").insert({
        event_code: it.event_code,
        severity: it.severity,
        fingerprint: it.fingerprint,
        channel: it.channel,
        target: it.target,
        status: "sent",
        error: null,
      });

      await sb
        .from("alert_dlq")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: "outbox_dispatcher",
          notes: `[${new Date().toISOString()}] resolved by outbox dispatcher`,
        })
        .eq("fingerprint", it.fingerprint)
        .eq("channel", it.channel)
        .eq("target", it.target)
        .in("status", ["pending", "retrying", "dead"]);
    } else {
      failed += 1;
      const err = String(it.error || "send_failed");

      await sb
        .from("alert_outbox")
        .update({ status: "failed", last_error: err })
        .eq("id", id)
        .eq("status", "sending");

      await sb.from("alert_dispatch_log").insert({
        event_code: it.event_code,
        severity: it.severity,
        fingerprint: it.fingerprint,
        channel: it.channel,
        target: it.target,
        status: "failed",
        error: err,
      });

      // best-effort DLQ insert
      await sb.from("alert_dlq").insert({
        event_code: it.event_code,
        severity: it.severity,
        channel: it.channel,
        target: it.target,
        fingerprint: it.fingerprint,
        error: err,
        attempts: 1,
        status: "pending",
        first_failed_at: new Date().toISOString(),
        last_failed_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        payload: { outbox_id: id, text: it.text, from: "outbox_dispatcher" },
      });
    }
  }

  console.log(JSON.stringify({ ok: true, sent, failed, total: results.items.length }));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: "internal", details: e?.message || String(e) }));
  process.exit(1);
});
