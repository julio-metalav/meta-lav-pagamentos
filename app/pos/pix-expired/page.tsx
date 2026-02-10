"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PosPixExpiredPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4 text-center">
        <h1 className="text-xl font-semibold text-[#F59E0B]">QR expirou</h1>
        <p className="text-sm text-[var(--text-secondary)]">Gere um novo QR ou volte para o resumo do ciclo.</p>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() =>
              router.push(
                `/pos/pix?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
                  machine_id
                )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(String(amount))}`
              )
            }
          >
            Gerar novo QR
          </button>

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
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
