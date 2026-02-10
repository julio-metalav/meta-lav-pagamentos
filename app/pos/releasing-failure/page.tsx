"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PosReleasingFailurePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const payment_id = sp.get("payment_id") || "";
  const machine_id = sp.get("machine_id") || "";
  const execute_key = sp.get("execute_key") || "";
  const error_code = sp.get("error_code") || "execute_failed";
  const error_message = sp.get("error_message") || "Não conseguimos liberar a máquina.";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold text-[#DC2626]">Não conseguimos liberar a máquina</h1>
        <p className="text-sm text-[var(--text-secondary)]">{error_message}</p>

        <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)] space-y-1">
          <p>error_code: {error_code}</p>
          <p>payment_id: {payment_id || "N/A"}</p>
          <p>execute_key: {execute_key || "N/A"}</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() =>
              router.push(
                `/pos/releasing?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&payment_id=${encodeURIComponent(
                  payment_id
                )}&machine_id=${encodeURIComponent(machine_id)}&execute_key=${encodeURIComponent(execute_key)}`
              )
            }
          >
            Tentar novamente
          </button>

          <button
            className="rounded-lg border border-[var(--border)] py-3"
            onClick={() => router.push(`/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
          >
            Trocar máquina
          </button>

          <button className="rounded-lg border border-[var(--border)] py-3" onClick={() => alert("Suporte: informe Payment ID e Execute Key")}>Chamar suporte</button>
        </div>
      </div>
    </div>
  );
}
