"use client";

import { useEffect, useMemo, useState } from "react";

type StatusResp = any;
type AlertResp = any;
type DispatchItem = { id: string; event_code: string; severity: string; channel: string; target: string; status: string; error: string | null; sent_at: string };
type DlqItem = { id: string; event_code: string; severity: string; channel: string; target: string; status: string; attempts: number; error: string; created_at: string };

function cardTone(kind: "neutral" | "ok" | "warn" | "danger") {
  if (kind === "ok") return "border-emerald-200 bg-emerald-50";
  if (kind === "warn") return "border-amber-200 bg-amber-50";
  if (kind === "danger") return "border-red-200 bg-red-50";
  return "border-zinc-200 bg-white";
}

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [alert, setAlert] = useState<AlertResp | null>(null);
  const [dispatchLog, setDispatchLog] = useState<DispatchItem[]>([]);
  const [dlqItems, setDlqItems] = useState<DlqItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [alertsOpen, setAlertsOpen] = useState(false);
  const [replayBusyId, setReplayBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const [s, a, dlog, dlq] = await Promise.all([
        fetch("/api/payments/compensation/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        fetch("/api/payments/compensation/alert", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        fetch("/api/admin/alerts/dispatch-log?limit=15"),
        fetch("/api/admin/alerts/dlq?limit=15"),
      ]);

      const sj = await s.json();
      const aj = await a.json();
      const dj = await dlog.json();
      const qj = await dlq.json();

      setStatus(sj);
      setAlert(aj);
      setDispatchLog(dj?.items || []);
      setDlqItems(qj?.items || []);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function replayDlq(id: string) {
    setReplayBusyId(id);
    setMessage(null);
    try {
      const r = await fetch(`/api/admin/alerts/replay/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard", note: "manual replay from dashboard" }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha no replay");
      setMessage("Replay enviado com sucesso.");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erro no replay da DLQ.");
    } finally {
      setReplayBusyId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const kpis = useMemo(() => {
    const pago = Number(status?.payments?.pago || 0);
    const expirado = Number(status?.payments?.expirado || 0);
    const estornado = Number(status?.payments?.estornado || 0);
    const stale = Number(status?.cycles?.stale_aguardando_liberacao || 0);
    const alertCount = Array.isArray(alert?.alerts) ? alert.alerts.length : 0;
    const dlqOpen = dlqItems.filter((x) => ["pending", "retrying", "dead"].includes(x.status)).length;
    return { pago, expirado, estornado, stale, alertCount, dlqOpen };
  }, [status, alert, dlqItems]);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="bg-slate-700 text-white px-6 py-4 shadow-sm">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-wide">META-LAV · DASHBOARD OPERACIONAL</h1>
          <button onClick={load} className="rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">Atualizar</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6 space-y-4">
        {message && <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">{message}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Pagos" value={String(kpis.pago)} subtitle="Transações confirmadas" tone="ok" />
          <KpiCard title="Expirados" value={String(kpis.expirado)} subtitle="Pendentes de compensação" tone={kpis.expirado > 0 ? "warn" : "neutral"} />
          <KpiCard title="Estornados" value={String(kpis.estornado)} subtitle="Compensados" tone="neutral" />
          <KpiCard title="Ciclos Stale" value={String(kpis.stale)} subtitle="Aguardando liberação" tone={kpis.stale > 0 ? "danger" : "ok"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button onClick={() => setAlertsOpen(true)} className={`text-left rounded-xl border p-4 shadow-sm ${cardTone(kpis.alertCount > 0 || kpis.dlqOpen > 0 ? "warn" : "neutral")}`}>
            <p className="text-xs text-zinc-500">Alertas operacionais</p>
            <p className="text-2xl font-bold">{kpis.alertCount}</p>
            <p className="text-xs text-zinc-600">DLQ aberta: {kpis.dlqOpen}</p>
          </button>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-zinc-500">Monitor</p>
            <p className="text-lg font-semibold">{loading ? "Atualizando..." : alert?.has_alert ? "Atenção" : "Saudável"}</p>
            <p className="text-xs text-zinc-600">Clique em “Alertas operacionais” para detalhes</p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-zinc-500">Resumo rápido</p>
            <p className="text-sm text-zinc-700 mt-1">PAGO={kpis.pago} · EXPIRADO={kpis.expirado} · ESTORNADO={kpis.estornado}</p>
            <p className="text-sm text-zinc-700">STALE_AGUARDANDO_LIBERACAO={kpis.stale}</p>
          </div>
        </div>
      </main>

      {alertsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-6xl bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Drill-down · Alertas</h2>
              <button onClick={() => setAlertsOpen(false)} className="text-zinc-500 hover:text-zinc-700">✕</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
              <section className="rounded-xl border border-zinc-200">
                <header className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
                  <h3 className="font-medium">Dispatch Log (últimos)</h3>
                </header>
                <div className="max-h-[420px] overflow-auto">
                  {dispatchLog.length === 0 ? (
                    <p className="p-4 text-sm text-zinc-500">Sem eventos recentes.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-zinc-500">
                        <tr>
                          <th className="text-left px-3 py-2">Evento</th>
                          <th className="text-left px-3 py-2">Canal</th>
                          <th className="text-left px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {dispatchLog.map((x) => (
                          <tr key={x.id}>
                            <td className="px-3 py-2">
                              <p className="font-medium">{x.event_code}</p>
                              <p className="text-xs text-zinc-500">{new Date(x.sent_at).toLocaleString()}</p>
                            </td>
                            <td className="px-3 py-2 text-xs">{x.channel} · {x.target}</td>
                            <td className="px-3 py-2 text-xs">{x.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200">
                <header className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
                  <h3 className="font-medium">DLQ (replay manual)</h3>
                </header>
                <div className="max-h-[420px] overflow-auto">
                  {dlqItems.length === 0 ? (
                    <p className="p-4 text-sm text-zinc-500">Sem itens na DLQ.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-zinc-500">
                        <tr>
                          <th className="text-left px-3 py-2">Evento</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-right px-3 py-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {dlqItems.map((x) => (
                          <tr key={x.id}>
                            <td className="px-3 py-2">
                              <p className="font-medium">{x.event_code}</p>
                              <p className="text-xs text-zinc-500">attempts={x.attempts} · {x.error}</p>
                            </td>
                            <td className="px-3 py-2 text-xs">{x.status}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                disabled={replayBusyId === x.id}
                                onClick={() => replayDlq(x.id)}
                                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                              >
                                {replayBusyId === x.id ? "Reenviando..." : "Replay"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, value, subtitle, tone = "neutral" }: { title: string; value: string; subtitle: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${cardTone(tone)}`}>
      <p className="text-xs text-zinc-500">{title}</p>
      <p className="text-3xl font-bold leading-tight">{value}</p>
      <p className="text-xs text-zinc-600 mt-1">{subtitle}</p>
    </div>
  );
}
