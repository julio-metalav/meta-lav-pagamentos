"use client";

import { useEffect, useState } from "react";

export default function OperacionalCiclosPage() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/api/payments/compensation/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Operacional · Ciclos (TTL)</h1>
        <div className="card p-4">
          <p className="text-sm text-[var(--text-secondary)]">Stale AGUARDANDO_LIBERACAO</p>
          <p className="text-2xl font-bold">{status?.cycles?.stale_aguardando_liberacao ?? "-"}</p>
          <p className="text-xs text-[var(--text-muted)] mt-2">Use o endpoint de alert/status para decisão operacional.</p>
        </div>
      </div>
    </div>
  );
}
