"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Resumo do ciclo</h1>

        <div className="card p-4 space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">Máquina</p>
          <p className="font-semibold">{tipo === "lavadora" ? "Lavadora" : "Secadora"} {identificador_local}</p>
          <p className="text-sm text-[var(--text-secondary)]">Preço</p>
          <p className="text-2xl font-bold text-[var(--brand-primary)]">R$ {amount.toFixed(2).replace(".", ",")}</p>

          <div className="text-xs text-[var(--text-secondary)] space-y-1 pt-2">
            <p>Após pagar, você tem alguns minutos para iniciar.</p>
            <p>Se não iniciar, estorno automático (quando habilitado).</p>
          </div>
        </div>

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
            Pagar com Pix
          </button>
          <button
            className="rounded-lg border border-[var(--border)] py-3 font-bold"
            onClick={() =>
              router.push(
                `/pos/confirmed?method=CARTAO&condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
                  machine_id
                )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(String(amount))}`
              )
            }
          >
            Pagar com Cartão
          </button>
          <button
            className="rounded-lg text-sm py-2 text-[var(--text-secondary)]"
            onClick={() =>
              router.push(`/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)
            }
          >
            Trocar máquina
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-muted)] break-all">machine_id={machine_id}</p>
      </div>
    </div>
  );
}
