"use client";

import { useEffect, useState } from "react";

type Item = { id: string; status: string; valor_centavos: number; metodo: string; gateway_pagamento: string; paid_at: string | null };

export default function OperacionalPagamentosPage() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/payments/compensation/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const status = await res.json();
      // MVP: tela operacional básica sem endpoint dedicado de listagem.
      setItems(
        [
          { id: "(usar endpoint dedicado na próxima iteração)", status: "INFO", valor_centavos: 0, metodo: "-", gateway_pagamento: status?.mode || "-", paid_at: status?.now || null },
        ] as any
      );
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Operacional · Pagamentos</h1>
        <div className="card p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-secondary)]">
                <th className="py-2">ID</th>
                <th>Status</th>
                <th>Método</th>
                <th>Gateway</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{x.id}</td>
                  <td>{x.status}</td>
                  <td>{x.metodo}</td>
                  <td>{x.gateway_pagamento}</td>
                  <td>{x.paid_at || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
