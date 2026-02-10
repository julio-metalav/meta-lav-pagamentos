"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function PosReleasingPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4 text-center">
        <h1 className="text-xl font-semibold">Enviando comando para a máquina...</h1>
        <div className="mx-auto h-10 w-10 rounded-full border-4 border-[var(--border)] border-t-[var(--brand-primary)] animate-spin" />
        <p className="text-sm text-[var(--text-secondary)]">POS-06 (placeholder): integração execute-cycle na próxima etapa.</p>

        <button
          className="rounded-lg border border-[var(--border)] py-3"
          onClick={() => router.push(`/pos/machines?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}`)}
        >
          Voltar para lista
        </button>
      </div>
    </div>
  );
}
