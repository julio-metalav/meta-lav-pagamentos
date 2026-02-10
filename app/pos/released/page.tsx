"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PosReleasedPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const payment_id = sp.get("payment_id") || "";
  const command_id = sp.get("command_id") || "";
  const cycle_id = sp.get("cycle_id") || "";
  const provider_ref = sp.get("provider_ref") || "";
  const machine_id = sp.get("machine_id") || "";
  const method = sp.get("method") || "PIX";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = sp.get("amount") || "0";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4 text-center">
        <p className="text-4xl">✅</p>
        <h1 className="text-xl font-semibold" style={{ color: "#16A34A" }}>
          Máquina liberada
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">Você pode iniciar agora.</p>

        <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)] space-y-1 text-left">
          <p>payment_id: {payment_id || "N/A"}</p>
          <p>command_id: {command_id || "N/A"}</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() =>
              router.push(
                `/pos/receipt?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&payment_id=${encodeURIComponent(
                  payment_id
                )}&machine_id=${encodeURIComponent(machine_id)}&command_id=${encodeURIComponent(command_id)}&cycle_id=${encodeURIComponent(
                  cycle_id
                )}&provider_ref=${encodeURIComponent(provider_ref)}&method=${encodeURIComponent(method)}&identificador_local=${encodeURIComponent(
                  identificador_local
                )}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(amount)}`
              )
            }
          >
            Ver comprovante
          </button>

          <button
            className="rounded-lg border border-[var(--border)] py-3"
            onClick={() => router.push(`/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
          >
            Voltar para lista de máquinas
          </button>
        </div>
      </div>
    </div>
  );
}
