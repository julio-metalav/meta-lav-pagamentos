"use client";

import { useMemo, useState } from "react";

type LatestReset = {
  id: string;
  channel: string;
  target: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  link: string | null;
};

type Notice = { tone: "neutral" | "success" | "error"; text: string } | null;

export default function ResetPage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("token") || "";
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const [latest, setLatest] = useState<LatestReset | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);

  async function requestReset(e: any) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/auth/reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha");
      setMsg({
        tone: "success",
        text: "Solicitação recebida. Se o usuário existir, o link de reset será enviado no WhatsApp do gestor.",
      });
      await loadLatestLink();
    } catch (err: any) {
      setMsg({ tone: "error", text: err?.message || "Erro ao solicitar reset." });
    } finally {
      setBusy(false);
    }
  }

  async function loadLatestLink() {
    setLoadingLatest(true);
    try {
      const r = await fetch("/api/admin/auth/reset/latest-link");
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao buscar último link");
      setLatest((j?.item || null) as LatestReset | null);
    } catch (err: any) {
      setMsg({ tone: "error", text: err?.message || "Erro ao buscar último link." });
    } finally {
      setLoadingLatest(false);
    }
  }

  async function copyLatestLink() {
    if (!latest?.link) return;
    try {
      await navigator.clipboard.writeText(latest.link);
      setMsg({ tone: "success", text: "Último link copiado para a área de transferência." });
    } catch {
      setMsg({ tone: "error", text: "Não foi possível copiar automaticamente. Copie manualmente abaixo." });
    }
  }

  async function confirmReset(e: any) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/auth/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha");
      setMsg({ tone: "success", text: "Senha redefinida com sucesso. Redirecionando para login..." });
      window.location.href = "/admin";
    } catch (err: any) {
      setMsg({ tone: "error", text: err?.message || "Erro ao confirmar reset." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
        <h1 className="text-lg font-semibold">Reset de senha</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Se você não receber mensagem em até 1 minuto, verifique o monitor de alertas/outbox.
        </p>
        {msg && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm border ${
              msg.tone === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : msg.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            {msg.text}
          </div>
        )}

        {!token ? (
          <>
            <form className="mt-4 space-y-3" onSubmit={requestReset}>
              <div>
                <label className="text-xs text-zinc-600">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
              </div>
              <button disabled={busy} className="w-full rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
                {busy ? "Enviando..." : "Enviar link"}
              </button>
            </form>

            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-600">Fallback operacional: último link gerado</p>
                <button
                  type="button"
                  onClick={loadLatestLink}
                  disabled={loadingLatest}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
                >
                  {loadingLatest ? "Carregando..." : "Atualizar"}
                </button>
              </div>

              {latest?.link ? (
                <>
                  <p className="text-[11px] text-zinc-500">status={latest.status} · criado em {new Date(latest.created_at).toLocaleString()}</p>
                  <div className="rounded border bg-white px-2 py-1 text-xs break-all">{latest.link}</div>
                  <button
                    type="button"
                    onClick={copyLatestLink}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-white"
                  >
                    Copiar link
                  </button>
                </>
              ) : (
                <p className="text-xs text-zinc-500">Sem link carregado ainda. Clique em “Atualizar” após solicitar reset.</p>
              )}
            </div>
          </>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={confirmReset}>
            <div>
              <label className="text-xs text-zinc-600">Nova senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
              <p className="text-xs text-zinc-500 mt-1">mín 6, letra+número+especial</p>
            </div>
            <button disabled={busy} className="w-full rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {busy ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
