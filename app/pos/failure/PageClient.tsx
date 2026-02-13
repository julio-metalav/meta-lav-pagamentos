"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold text-[#DC2626]">Sem conexão com o servidor</h1>
        <p className="text-sm text-[var(--text-secondary)]">Verifique internet/rede local e tente novamente.</p>

        <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)] space-y-1">
          <p>POS ID: {pos_serial || "N/A"}</p>
          <p>Condomínio: {condominio_id || "N/A"}</p>
          <p>Erro técnico: timeout / indisponível</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            className="rounded-lg bg-[var(--brand-primary)] text-white py-3 font-bold"
            onClick={() => router.push(`/pos?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
          >
            Tentar novamente
          </button>
          <button className="rounded-lg border border-[var(--border)] py-3" onClick={() => alert("Suporte: use POS ID para atendimento")}>Chamar suporte</button>
        </div>
      </div>
    </div>
  );
}
