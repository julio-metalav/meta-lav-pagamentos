"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function PosReceiptContent() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const payment_id = sp.get("payment_id") || "";
  const machine_id = sp.get("machine_id") || "";
  const command_id = sp.get("command_id") || "";
  const cycle_id = sp.get("cycle_id") || "";
  const provider_ref = sp.get("provider_ref") || "";
  const method = sp.get("method") || "PIX";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  const dateStr = useMemo(() => new Date().toLocaleString("pt-BR"), []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Comprovante</h1>

        <div className="rounded-lg border border-[var(--border)] p-4 space-y-2 text-sm">
          <p><strong>Valor:</strong> R$ {amount.toFixed(2).replace(".", ",")}</p>
          <p><strong>Forma:</strong> {method}</p>
          <p><strong>Data/Hora:</strong> {dateStr}</p>
          <p><strong>Máquina:</strong> {tipo === "lavadora" ? "Lavadora" : "Secadora"} {identificador_local}</p>
          <p><strong>Payment ID:</strong> {payment_id || "N/A"}</p>
          <p><strong>Provider ref:</strong> {provider_ref || "N/A"}</p>
          <p><strong>Cycle ID:</strong> {cycle_id || "N/A"}</p>
          <p><strong>Command ID:</strong> {command_id || "N/A"}</p>
          <p><strong>Machine ID:</strong> {machine_id || "N/A"}</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg border border-[var(--border)] py-3"
            onClick={() => alert("Compartilhar comprovante (MVP)")}
          >
            Compartilhar
          </button>

          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() => router.push(`/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
          <div className="card w-full max-w-md p-6 space-y-4 text-center">
            <p className="text-4xl">⏳</p>
            <h1 className="text-xl font-semibold">Carregando comprovante...</h1>
          </div>
        </div>
      }
    >
      <PosReceiptContent />
    </Suspense>
  );
}
