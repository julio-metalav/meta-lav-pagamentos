"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Machine = {
  id: string;
  identificador_local: string;
  tipo: "lavadora" | "secadora";
};

type MachineState = "LIVRE" | "RESERVADA" | "OCUPADA" | "INDISPONIVEL";

function chipColor(s: MachineState) {
  if (s === "LIVRE") return "#16A34A";
  if (s === "RESERVADA") return "#F59E0B";
  if (s === "OCUPADA") return "#DC2626";
  return "#6B7280";
}

function PosMachinesContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";

  const [items, setItems] = useState<Array<Machine & { state: MachineState; amount: number | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function run() {
      if (!condominio_id) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`);
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "Falha ao listar máquinas");

        const base: Machine[] = data.items || [];
        const enriched = await Promise.all(
          base.map(async (m) => {
            let state: MachineState = "INDISPONIVEL";
            let amount: number | null = null;

            try {
              const av = await fetch("/api/payments/availability", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  channel: "pos",
                  origin: { pos_device_id: null, user_id: null },
                  condominio_id,
                  condominio_maquinas_id: m.id,
                  service_type: m.tipo,
                }),
              });

              if (av.ok) state = "LIVRE";
              else {
                const e = await av.json().catch(() => ({}));
                const code = String(e?.error_v1?.code || "");
                state = code === "reserved" ? "RESERVADA" : "OCUPADA";
              }
            } catch {
              state = "INDISPONIVEL";
            }

            try {
              const pr = await fetch("/api/payments/price", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  channel: "pos",
                  origin: { pos_device_id: null, user_id: null },
                  condominio_id,
                  condominio_maquinas_id: m.id,
                  service_type: m.tipo,
                  context: { coupon_code: null },
                }),
              });
              const j = await pr.json().catch(() => ({}));
              amount = pr.ok ? Number(j?.quote?.amount || 0) : null;
            } catch {
              amount = null;
            }

            return { ...m, state, amount };
          })
        );

        setItems(enriched);
      } finally {
        setLoading(false);
      }
    }

    run();
  }, [condominio_id, pos_serial]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => x.identificador_local.toLowerCase().includes(s));
  }, [items, search]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Seleção de Máquina</h1>
          <span className="text-xs text-[var(--text-secondary)]">Atualizado agora</span>
        </div>

        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          placeholder="Digite o número da máquina"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((m) => (
              <button
                key={m.id}
                className="card p-3 text-left disabled:opacity-60"
                disabled={m.state !== "LIVRE"}
                onClick={() =>
                  router.push(
                    `/pos/summary?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
                      m.id
                    )}&identificador_local=${encodeURIComponent(m.identificador_local)}&tipo=${encodeURIComponent(m.tipo)}&amount=${encodeURIComponent(
                      String(m.amount || 0)
                    )}`
                  )
                }
              >
                <p className="font-semibold">{m.tipo === "lavadora" ? "Lavadora" : "Secadora"} {m.identificador_local}</p>
                <span className="pill mt-2" style={{ color: chipColor(m.state) }}>{m.state}</span>
                <p className="mt-2 text-sm">{m.amount ? `R$ ${m.amount.toFixed(2).replace(".", ",")}` : "Sem preço"}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PosMachinesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4">
          <div className="mx-auto max-w-3xl space-y-3">
            <h1 className="text-xl font-semibold">Seleção de Máquina</h1>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card h-28 animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <PosMachinesContent />
    </Suspense>
  );
}
