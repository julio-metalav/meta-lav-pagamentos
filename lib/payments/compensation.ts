import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ScanResult = {
  status: number;
  body: Record<string, unknown>;
};

function bad(message: string, status = 400, extra?: Record<string, unknown>): ScanResult {
  return { status, body: { ok: false, error: message, ...(extra || {}) } };
}

function isAuthorized(req: Request) {
  const secret = process.env.PAYMENTS_COMPENSATION_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("x-compensation-secret") || "";
  return got === secret;
}

const DELIVERED_CYCLE_STATUSES = ["LIBERADO", "EM_USO", "FINALIZADO"];
const SAFE_PENDING_STATUSES = ["AGUARDANDO_LIBERACAO", "ABORTADO"];
const PENDING_TTL_SEC = Number(process.env.PAYMENTS_PENDING_TTL_SEC || 300);

function compensationMode() {
  return String(process.env.PAYMENTS_COMPENSATION_MODE || "simulate").trim().toLowerCase();
}

function toSeverity(level: "warn" | "critical"): "warning" | "critical" {
  return level === "critical" ? "critical" : "warning";
}

function makeAlertFingerprint(input: { code: string; level: "warn" | "critical"; snapshot: any }) {
  const payload = {
    code: input.code,
    level: input.level,
    expirado: Number(input.snapshot?.payments?.expirado || 0),
    pago: Number(input.snapshot?.payments?.pago || 0),
    estornado: Number(input.snapshot?.payments?.estornado || 0),
    stale: Number(input.snapshot?.cycles?.stale_aguardando_liberacao || 0),
    mode: String(input.snapshot?.mode || ""),
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function resolveDlqOnSuccess(admin: any, route: any, fingerprint: string) {
  await admin
    .from("alert_dlq")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "monitor_dispatch",
      notes: `[${new Date().toISOString()}] resolved after successful dispatch`,
    })
    .eq("channel", route.channel)
    .eq("target", route.target)
    .eq("fingerprint", fingerprint)
    .in("status", ["pending", "retrying", "dead"]);
}

async function upsertDlqOnFailure(admin: any, params: {
  route: any;
  alert: { code: string; level: "warn" | "critical"; message: string };
  fingerprint: string;
  snapshot: any;
  reason: string;
}) {
  const { route, alert, fingerprint, snapshot, reason } = params;

  const { data: existing } = await admin
    .from("alert_dlq")
    .select("id,attempts,status")
    .eq("channel", route.channel)
    .eq("target", route.target)
    .eq("fingerprint", fingerprint)
    .in("status", ["pending", "retrying"])
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("alert_dlq")
      .update({
        attempts: Number(existing.attempts || 0) + 1,
        status: "retrying",
        error: reason,
        last_failed_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  await admin.from("alert_dlq").insert({
    event_code: alert.code,
    severity: toSeverity(alert.level),
    channel: route.channel,
    target: route.target,
    payload: {
      alert,
      snapshot,
      route: {
        id: route.id,
        event_code: route.event_code,
      },
    },
    fingerprint,
    error: reason,
    attempts: 1,
    status: "pending",
    first_failed_at: new Date().toISOString(),
    last_failed_at: new Date().toISOString(),
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
}

async function dispatchAlertsForRoutes(params: {
  alerts: Array<{ level: "warn" | "critical"; code: string; message: string }>;
  snapshot: any;
}) {
  const { alerts, snapshot } = params;
  if (!alerts.length) return { attempted: 0, sent: 0, failed: 0 };

  const admin = supabaseAdmin() as any;
  const { data: routes } = await admin
    .from("alert_routes")
    .select("id,enabled,event_code,channel,target")
    .eq("enabled", true);

  const activeRoutes = (routes || []) as Array<any>;
  if (!activeRoutes.length) return { attempted: 0, sent: 0, failed: 0 };

  let attempted = 0;
  let queued = 0;
  let failed = 0;

  for (const alert of alerts) {
    for (const route of activeRoutes) {
      if (!(route.event_code === "all" || route.event_code === alert.code)) continue;
      attempted += 1;

      const fingerprint = makeAlertFingerprint({ code: alert.code, level: alert.level, snapshot });
      const text = `ALERTA ${alert.code} (${alert.level}) | ${alert.message}`;

      // Enfileira no outbox para o dispatcher do OpenClaw enviar de fato.
      const { error: outErr } = await admin.from("alert_outbox").insert({
        event_code: alert.code,
        severity: toSeverity(alert.level),
        fingerprint,
        channel: route.channel,
        target: route.target,
        text,
        status: "pending",
        attempts: 0,
      });

      if (outErr) {
        failed += 1;
        const reason = `outbox_enqueue_failed:${outErr.message}`;
        await admin.from("alert_dispatch_log").insert({
          event_code: alert.code,
          severity: toSeverity(alert.level),
          fingerprint,
          channel: route.channel,
          target: route.target,
          status: "failed",
          error: reason,
        });
        await upsertDlqOnFailure(admin, { route, alert, fingerprint, snapshot, reason });
        continue;
      }

      queued += 1;
      await admin.from("alert_dispatch_log").insert({
        event_code: alert.code,
        severity: toSeverity(alert.level),
        fingerprint,
        channel: route.channel,
        target: route.target,
        status: "skipped_dedupe",
        error: "queued_outbox",
      });
    }
  }

  return { attempted, queued, failed };
}

async function postJson(url: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-idempotency-key": String(payload.idempotency_key || ""),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { ok: res.ok, status: res.status, json };
}

async function requestRefund(payment: { id: string; gateway_pagamento: string | null; external_id: string | null }) {
  const mode = compensationMode();

  if (mode === "simulate") {
    return {
      ok: true,
      provider_refund_id: `sim_refund_${payment.id}`,
      simulated: true,
    };
  }

  if (!payment.external_id) {
    return {
      ok: false,
      code: "missing_external_id",
      message: "payment external_id is required for provider refund",
    };
  }

  const gw = String(payment.gateway_pagamento || "").toUpperCase();
  const idempotency_key = `refund:${payment.id}:undelivered_v1`;

  if (gw === "STONE") {
    const url = process.env.STONE_REFUND_URL || "";
    const token = process.env.STONE_API_KEY || "";
    if (!url || !token) {
      return { ok: false, code: "stone_not_configured", message: "STONE_REFUND_URL/STONE_API_KEY missing" };
    }

    const call = await postJson(url, token, {
      payment_ref: payment.external_id,
      idempotency_key,
      reason: "undelivered_cycle",
    });

    if (!call.ok) {
      return {
        ok: false,
        code: "stone_refund_failed",
        message: `stone refund failed (${call.status})`,
      };
    }

    return {
      ok: true,
      provider_refund_id: String(call.json?.refund_id || call.json?.id || `stone_refund_${payment.id}`),
      simulated: false,
    };
  }

  if (gw === "ASAAS") {
    const url = process.env.ASAAS_REFUND_URL || "";
    const token = process.env.ASAAS_API_KEY || "";
    if (!url || !token) {
      return { ok: false, code: "asaas_not_configured", message: "ASAAS_REFUND_URL/ASAAS_API_KEY missing" };
    }

    const call = await postJson(url, token, {
      payment_ref: payment.external_id,
      idempotency_key,
      reason: "undelivered_cycle",
    });

    if (!call.ok) {
      return {
        ok: false,
        code: "asaas_refund_failed",
        message: `asaas refund failed (${call.status})`,
      };
    }

    return {
      ok: true,
      provider_refund_id: String(call.json?.refund_id || call.json?.id || `asaas_refund_${payment.id}`),
      simulated: false,
    };
  }

  return {
    ok: false,
    code: "gateway_not_supported",
    message: `gateway ${gw || "unknown"} not supported for refund`,
  };
}

export async function scanUndeliveredPaid(req: Request): Promise<ScanResult> {
  try {
    if (!isAuthorized(req)) return bad("Não autorizado", 401);

    const body = await req.json().catch(() => ({}));
    const slaSec = Number(body?.sla_sec || process.env.PAYMENTS_DELIVERY_SLA_SEC || 180);
    const limit = Math.min(200, Math.max(1, Number(body?.limit || 100)));
    const now = Date.now();
    const cutoffIso = new Date(now - slaSec * 1000).toISOString();

    const admin = supabaseAdmin() as any;

    const { data: candidates, error: candErr } = await admin
      .from("pagamentos")
      .select("id,status,paid_at,created_at,maquina_id,condominio_id")
      .eq("status", "PAGO")
      .not("paid_at", "is", null)
      .lte("paid_at", cutoffIso)
      .order("paid_at", { ascending: true })
      .limit(limit);

    if (candErr) return bad("Erro ao buscar pagamentos candidatos.", 500, { details: candErr.message });

    const rows = (candidates || []) as Array<{
      id: string;
      status: string;
      paid_at: string | null;
      created_at: string;
      maquina_id: string | null;
      condominio_id: string;
    }>;

    const marked: string[] = [];
    const skippedDelivered: string[] = [];
    const skippedActive: string[] = [];
    const errors: Array<{ payment_id: string; error: string }> = [];

    for (const p of rows) {
      const { data: cycle, error: cErr } = await admin
        .from("ciclos")
        .select("id,status,created_at")
        .eq("pagamento_id", p.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cErr) {
        errors.push({ payment_id: p.id, error: cErr.message });
        continue;
      }

      if (cycle && DELIVERED_CYCLE_STATUSES.includes(String(cycle.status || ""))) {
        skippedDelivered.push(p.id);
        continue;
      }

      if (cycle && !SAFE_PENDING_STATUSES.includes(String(cycle.status || ""))) {
        skippedActive.push(p.id);
        continue;
      }

      // Fase 1 W4 (sem estorno externo ainda): marcar pagamento como EXPIRADO
      // para acionar trilha de compensação em fase seguinte.
      const { data: updated, error: uErr } = await admin
        .from("pagamentos")
        .update({ status: "EXPIRADO" })
        .eq("id", p.id)
        .eq("status", "PAGO")
        .select("id,status")
        .maybeSingle();

      if (uErr) {
        errors.push({ payment_id: p.id, error: uErr.message });
        continue;
      }

      if (updated?.id) {
        marked.push(updated.id);
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        mode: "phase1-marker",
        marker_status: "EXPIRADO",
        sla_sec: slaSec,
        scanned: rows.length,
        marked_count: marked.length,
        marked,
        skipped_delivered_count: skippedDelivered.length,
        skipped_active_count: skippedActive.length,
        error_count: errors.length,
        errors,
      },
    };
  } catch (e: any) {
    return bad("Erro interno no scan de compensação.", 500, { details: e?.message || String(e) });
  }
}

export async function executeExpiredCompensation(req: Request): Promise<ScanResult> {
  try {
    if (!isAuthorized(req)) return bad("Não autorizado", 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(100, Math.max(1, Number(body?.limit || 50)));

    const admin = supabaseAdmin() as any;

    const { data: candidates, error: candErr } = await admin
      .from("pagamentos")
      .select("id,status,gateway_pagamento,external_id,paid_at,created_at")
      .eq("status", "EXPIRADO")
      .order("paid_at", { ascending: true })
      .limit(limit);

    if (candErr) return bad("Erro ao buscar pagamentos expirados.", 500, { details: candErr.message });

    const rows = (candidates || []) as Array<{
      id: string;
      status: string;
      gateway_pagamento: string | null;
      external_id: string | null;
      paid_at: string | null;
      created_at: string;
    }>;

    const refunded: string[] = [];
    const skipped: Array<{ payment_id: string; reason: string }> = [];
    const errors: Array<{ payment_id: string; error: string }> = [];

    for (const p of rows) {
      const refund = await requestRefund({
        id: p.id,
        gateway_pagamento: p.gateway_pagamento,
        external_id: p.external_id,
      });

      if (!refund.ok) {
        skipped.push({ payment_id: p.id, reason: String((refund as any).code || "refund_failed") });
        continue;
      }

      const { data: updated, error: uErr } = await admin
        .from("pagamentos")
        .update({ status: "ESTORNADO" })
        .eq("id", p.id)
        .eq("status", "EXPIRADO")
        .select("id,status")
        .maybeSingle();

      if (uErr) {
        errors.push({ payment_id: p.id, error: uErr.message });
        continue;
      }

      if (updated?.id) refunded.push(updated.id);
    }

    return {
      status: 200,
      body: {
        ok: true,
        mode: `phase2-executor:${compensationMode()}`,
        scanned: rows.length,
        refunded_count: refunded.length,
        refunded,
        skipped_count: skipped.length,
        skipped,
        error_count: errors.length,
        errors,
      },
    };
  } catch (e: any) {
    return bad("Erro interno no executor de compensação.", 500, { details: e?.message || String(e) });
  }
}

export async function compensationStatus(req: Request): Promise<ScanResult> {
  try {
    if (!isAuthorized(req)) return bad("Não autorizado", 401);

    const admin = supabaseAdmin() as any;
    const nowIso = new Date().toISOString();
    const staleCutoffIso = new Date(Date.now() - PENDING_TTL_SEC * 1000).toISOString();

    const [{ count: expiredCount }, { count: paidCount }, { count: refundedCount }, { count: stalePendingCount }] = await Promise.all([
      admin.from("pagamentos").select("id", { count: "exact", head: true }).eq("status", "EXPIRADO"),
      admin.from("pagamentos").select("id", { count: "exact", head: true }).eq("status", "PAGO"),
      admin.from("pagamentos").select("id", { count: "exact", head: true }).eq("status", "ESTORNADO"),
      admin
        .from("ciclos")
        .select("id", { count: "exact", head: true })
        .eq("status", "AGUARDANDO_LIBERACAO")
        .lte("created_at", staleCutoffIso),
    ]);

    return {
      status: 200,
      body: {
        ok: true,
        mode: compensationMode(),
        now: nowIso,
        pending_ttl_sec: PENDING_TTL_SEC,
        payments: {
          pago: paidCount || 0,
          expirado: expiredCount || 0,
          estornado: refundedCount || 0,
        },
        cycles: {
          stale_aguardando_liberacao: stalePendingCount || 0,
        },
        providers: {
          stone_configured: !!(process.env.STONE_REFUND_URL && process.env.STONE_API_KEY),
          asaas_configured: !!(process.env.ASAAS_REFUND_URL && process.env.ASAAS_API_KEY),
        },
      },
    };
  } catch (e: any) {
    return bad("Erro interno no status de compensação.", 500, { details: e?.message || String(e) });
  }
}

export async function compensationAlert(req: Request): Promise<ScanResult> {
  const s = await compensationStatus(req);
  if (s.status !== 200) return s;

  const body = s.body as any;
  const expired = Number(body?.payments?.expirado || 0);
  const stale = Number(body?.cycles?.stale_aguardando_liberacao || 0);
  const mode = String(body?.mode || "simulate");
  const stoneOk = !!body?.providers?.stone_configured;
  const asaasOk = !!body?.providers?.asaas_configured;

  const alerts: Array<{ level: "warn" | "critical"; code: string; message: string }> = [];

  if (stale > 0) {
    alerts.push({ level: "warn", code: "stale_pending_cycles", message: `${stale} ciclos pendentes stale` });
  }
  if (expired > 0 && mode === "real" && !stoneOk && !asaasOk) {
    alerts.push({ level: "critical", code: "refund_provider_not_configured", message: "Há EXPIRADO sem provider de estorno configurado" });
  }
  if (expired >= 20) {
    alerts.push({ level: "warn", code: "expired_backlog_high", message: `Backlog de EXPIRADO alto (${expired})` });
  }

  const dispatch = await dispatchAlertsForRoutes({ alerts, snapshot: body });

  return {
    status: 200,
    body: {
      ok: true,
      has_alert: alerts.length > 0,
      alerts,
      dispatch,
      snapshot: body,
    },
  };
}
