"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PosReleasingPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const condominio_id = sp.get("condominio_id") || "";
  const pos_serial = sp.get("pos_serial") || "";
  const machine_id = sp.get("machine_id") || "";
  const payment_id = sp.get("payment_id") || "";
  const provider_ref = sp.get("provider_ref") || "";
  const execute_key = sp.get("execute_key") || crypto.randomUUID();

  const [message, setMessage] = useState("Enviando comando para a máquina...");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/payments/execute-cycle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel: "pos",
            origin: { pos_device_id: null, user_id: null },
            idempotency_key: execute_key,
            payment_id,
            condominio_maquinas_id: machine_id,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data?.ok) {
          const err = data?.error_v1?.message || data?.error || "Falha ao liberar máquina";
          const code = data?.error_v1?.code || "execute_failed";
          if (!cancelled) {
            router.replace(
              `/pos/releasing-failure?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&payment_id=${encodeURIComponent(
                payment_id
              )}&machine_id=${encodeURIComponent(machine_id)}&execute_key=${encodeURIComponent(execute_key)}&error_code=${encodeURIComponent(
                String(code)
              )}&error_message=${encodeURIComponent(String(err))}`
            );
          }
          return;
        }

        if (!cancelled) {
          setMessage("Máquina liberada com sucesso");
          const method = sp.get("method") || "PIX";
          const identificador_local = sp.get("identificador_local") || "";
          const tipo = sp.get("tipo") || "lavadora";
          const amount = sp.get("amount") || "0";

          router.replace(
            `/pos/released?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&payment_id=${encodeURIComponent(
              payment_id
            )}&machine_id=${encodeURIComponent(machine_id)}&command_id=${encodeURIComponent(String(data.command_id || ""))}&cycle_id=${encodeURIComponent(
              String(data.cycle_id || "")
            )}&provider_ref=${encodeURIComponent(provider_ref)}&method=${encodeURIComponent(method)}&identificador_local=${encodeURIComponent(
              identificador_local
            )}&tipo=${encodeURIComponent(tipo)}&amount=${encodeURIComponent(amount)}`
          );
        }
      } catch (e: any) {
        if (!cancelled) {
          router.replace(
            `/pos/releasing-failure?condominio_id=${encodeURIComponent(condominio_id)}&pos_serial=${encodeURIComponent(pos_serial)}&payment_id=${encodeURIComponent(
              payment_id
            )}&machine_id=${encodeURIComponent(machine_id)}&execute_key=${encodeURIComponent(execute_key)}&error_code=network_error&error_message=${encodeURIComponent(
              e?.message || "Falha de rede"
            )}`
          );
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, condominio_id, pos_serial, machine_id, payment_id, provider_ref, execute_key]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 flex items-center justify-center">
      <div className="card w-full max-w-md p-6 space-y-4 text-center">
        <h1 className="text-xl font-semibold">Enviando comando para a máquina...</h1>
        <div className="mx-auto h-10 w-10 rounded-full border-4 border-[var(--border)] border-t-[var(--brand-primary)] animate-spin" />
        <p className="text-sm text-[var(--text-secondary)]">{message}</p>
        <p className="text-xs text-[var(--text-muted)]">payment_id={payment_id || "N/A"}</p>
      </div>
    </div>
  );
}
