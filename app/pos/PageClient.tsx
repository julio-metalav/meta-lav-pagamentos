"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Check = "ok" | "warn";

export default function PageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";

  const [internet, setInternet] = useState<Check>("warn");
  const [backend, setBackend] = useState<Check>("warn");
  const [gateway, setGateway] = useState<Check>("warn");

  const allOk = useMemo(() => internet === "ok" && backend === "ok" && gateway === "ok", [internet, backend, gateway]);

  useEffect(() => {
    setInternet(navigator.onLine ? "ok" : "warn");

    async function run() {
      try {
        const b = await fetch("/api/payments/compensation/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        setBackend(b.ok ? "ok" : "warn");
      } catch {
        setBackend("warn");
      }

      try {
        const g = await fetch(`/api/admin/gateways?condominio_id=${encodeURIComponent(condominio_id)}&limit=1`);
        const j = await g.json();
        setGateway(g.ok && j?.ok ? "ok" : "warn");
      } catch {
        setGateway("warn");
      }
    }

    run();
  }, [condominio_id]);

  useEffect(() => {
    if (!allOk) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (condominio_id) qs.set("condominio_id", condominio_id);
      if (pos_serial) qs.set("pos_serial", pos_serial);
      router.push(`/pos/machines?${qs.toString()}`);
    }, 900);
    return () => clearTimeout(t);
  }, [allOk, condominio_id, pos_serial, router]);

  const statusChip = (label: string, v: Check) => (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="pill" style={{ color: v === "ok" ? "#16A34A" : "#F59E0B" }}>{v === "ok" ? "✅" : "⚠️"}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Meta-Lav POS</h1>
        <p className="text-sm text-[var(--text-secondary)]">Conectando ao sistema...</p>

        <div className="space-y-2">
          {statusChip("Internet", internet)}
          {statusChip("Backend", backend)}
          {statusChip("Gateway", gateway)}
        </div>

        {!allOk && (
          <button
            className="w-full rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() => router.push(`/pos/failure?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
          >
            Ver diagnóstico
          </button>
        )}
      </div>
    </div>
  );
}
