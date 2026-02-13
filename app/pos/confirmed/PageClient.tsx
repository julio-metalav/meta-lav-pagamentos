"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const method = sp.get("method") || "PIX";
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const identificador_local = sp.get("identificador_local") || "";
  const tipo = sp.get("tipo") || "lavadora";
  const amount = Number(sp.get("amount") || 0);

  const [status, setStatus] = useState("Preparando autorização...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const idempotencyAuth = crypto.randomUUID();
        setStatus("Autorizando pagamento...");

        const auth = await fetch("/api/pos/authorize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-pos-local-time": new Date().toISOString(),
            "x-pos-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Cuiaba",
          },
          body: JSON.stringify({
            channel: "pos",
            origin: { pos_device_id: null, user_id: null },
            pos_serial,
            identificador_local,
            metodo: method === "CARTAO" ? "CARTAO" : "PIX",
            valor_centavos: Math.round(amount * 100),
            idempotency_key: idempotencyAuth,
            metadata: { pos_flow: "POS-05" },
          }),
        });

        const authJson = await auth.json();
        if (!auth.ok || !authJson?.ok) throw new Error(authJson?.error_v1?.message || authJson?.error || "Falha no authorize");

        const paymentId = String(authJson.pagamento_id || "");
        if (!paymentId) throw new Error("payment_id ausente no authorize");

        setStatus("Confirmando pagamento...");
        const providerRef = `stone_pos_${crypto.randomUUID()}`;

        const confirm = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel: "pos",
            origin: { pos_device_id: null, user_id: null },
            payment_id: paymentId,
            provider: "stone",
            provider_ref: providerRef,
            result: "approved",
          }),
        });

        const confirmJson = await confirm.json();
        if (!confirm.ok || !confirmJson?.ok) throw new Error(confirmJson?.error_v1?.message || confirmJson?.error || "Falha no confirm");

        const executeKey = crypto.randomUUID();

        if (!cancelled) {
          router.replace(
            `/pos/releasing?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&machine_id=${encodeURIComponent(
              machine_id
            )}&identificador_local=${encodeURIComponent(identificador_local)}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(
              String(amount)
            )}&method=${encodeURIComponent(method)}&payment_id=${encodeURIComponent(paymentId)}&provider_ref=${encodeURIComponent(
              providerRef
            )}&execute_key=${encodeURIComponent(executeKey)}`
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Falha no fluxo de confirmação");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, condominio_id, pos_serial, machine_id, identificador_local, tipo, amount, method]);

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
        <div className="card w-full max-w-md p-6 space-y-3 text-center">
          <p className="text-4xl">⚠️</p>
          <h1 className="text-xl font-semibold" style={{ color: "#DC2626" }}>
            Erro ao confirmar
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
          <button className="rounded-lg border border-[var(--border)] py-3" onClick={() => router.back()}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-3 text-center">
        <p className="text-4xl">✅</p>
        <h1 className="text-xl font-semibold" style={{ color: "#16A34A" }}>
          Pagamento confirmado
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">Forma: {method}</p>
        <p className="text-sm text-[var(--text-secondary)]">{status}</p>
      </div>
    </div>
  );
}
