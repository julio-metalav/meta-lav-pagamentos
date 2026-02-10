"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PosConfirmedPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const method = sp.get("method") || "PIX";
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  useEffect(() => {
    const t = setTimeout(() => {
      router.push(
        `/pos/releasing?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
          machine_id
        )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(
          String(amount)
        )}&method=${encodeURIComponent(method)}`
      );
    }, 1200);

    return () => clearTimeout(t);
  }, [router, condominio_id, pos_serial, machine_id, identificador_local, tipo, amount, method]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-3 text-center">
        <p className="text-4xl">✅</p>
        <h1 className="text-xl font-semibold" style={{ color: "#16A34A" }}>
          Pagamento confirmado
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">Forma: {method}. Liberando máquina...</p>
      </div>
    </div>
  );
}
