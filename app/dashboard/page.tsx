"use client";

import { useEffect, useState } from "react";

type StatusResp = any;

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [alert, setAlert] = useState<any>(null);

  useEffect(() => {
    async function load() {
      const s = await fetch("/api/payments/compensation/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const a = await fetch("/api/payments/compensation/alert", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setStatus(await s.json());
      setAlert(await a.json());
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard Operacional</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-4"><p className="text-xs text-[var(--text-secondary)]">Receita hoje (proxy)</p><p className="text-xl font-bold">—</p></div>
          <div className="card p-4"><p className="text-xs text-[var(--text-secondary)]">Pagos</p><p className="text-xl font-bold">{status?.payments?.pago ?? "-"}</p></div>
          <div className="card p-4"><p className="text-xs text-[var(--text-secondary)]">Expirados</p><p className="text-xl font-bold">{status?.payments?.expirado ?? "-"}</p></div>
          <div className="card p-4"><p className="text-xs text-[var(--text-secondary)]">Estornados</p><p className="text-xl font-bold">{status?.payments?.estornado ?? "-"}</p></div>
        </div>

        <div className="card p-4">
          <h2 className="font-semibold mb-2">Alertas</h2>
          {!alert?.has_alert ? (
            <p className="text-sm text-[var(--text-secondary)]">Sem alertas críticos.</p>
          ) : (
            <ul className="space-y-2">
              {(alert?.alerts || []).map((x: any, i: number) => (
                <li key={i} className="text-sm">
                  <span className="pill" style={{ color: x.level === "critical" ? "#DC2626" : "#F59E0B" }}>{x.level}</span>
                  <span className="ml-2">{x.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
