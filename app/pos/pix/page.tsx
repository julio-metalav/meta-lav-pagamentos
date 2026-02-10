"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const TOTAL_SECONDS = 5 * 60;

function formatTimer(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function PosPixContent() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  const [left, setLeft] = useState(TOTAL_SECONDS);
  const [paused, setPaused] = useState(false);
  const [pixNonce] = useState(() => crypto.randomUUID().slice(0, 8));

  useEffect(() => {
    if (paused) return;
    if (left <= 0) {
      router.replace(
        `/pos/pix-expired?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
          machine_id
        )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(String(amount))}`
      );
      return;
    }

    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left, paused, router, condominio_id, pos_serial, machine_id, identificador_local, tipo, amount]);

  const fakePixCode = useMemo(() => `000201PIX-METALAV-${machine_id.slice(0, 8)}-${pixNonce}`, [machine_id, pixNonce]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Pagamento PIX</h1>

        <div className="card p-4 space-y-3 text-center">
          <div className="mx-auto h-56 w-56 rounded-lg border border-[var(--border)] grid place-items-center bg-[var(--surface)]">
            <span className="text-xs text-[var(--text-secondary)]">QR PIX</span>
          </div>

          <p className="text-2xl font-bold text-[var(--brand-primary)]">R$ {amount.toFixed(2).replace(".", ",")}</p>
          <p className="text-sm text-[var(--text-secondary)]">Expira em {formatTimer(left)}</p>
          <p className="text-xs text-[var(--text-muted)] break-all">{fakePixCode}</p>

          <p className="text-sm text-[var(--text-secondary)]">Aguardando pagamento...</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg border border-[var(--border)] py-3"
            onClick={() =>
              router.push(
                `/pos/summary?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
                  machine_id
                )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(String(amount))}`
              )
            }
          >
            Cancelar
          </button>

          <button
            className="rounded-lg border border-[var(--border)] py-3"
            onClick={() => {
              setPaused(false);
              setLeft(TOTAL_SECONDS);
            }}
          >
            Regenerar QR
          </button>

          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() =>
              router.push(
                `/pos/confirmed?method=PIX&condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
                  machine_id
                )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(String(amount))}`
              )
            }
          >
            Simular pagamento confirmado
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosPixPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
          <div className="card w-full max-w-md p-6 space-y-3 text-center">
            <p className="text-4xl">⏳</p>
            <h1 className="text-xl font-semibold">Carregando PIX...</h1>
          </div>
        </div>
      }
    >
      <PosPixContent />
    </Suspense>
  );
}
