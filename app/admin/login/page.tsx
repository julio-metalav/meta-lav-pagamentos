"use client";

import { useMemo, useState } from "react";

type Notice = { tone: "neutral" | "success" | "error"; text: string } | null;

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/admin";
    const u = new URL(window.location.href);
    return u.searchParams.get("next") || "/admin";
  }, []);

  async function onSubmit(e: any) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha no login");
      setMsg({ tone: "success", text: "Login validado. Redirecionando..." });
      window.location.href = next;
    } catch (err: any) {
      setMsg({ tone: "error", text: err?.message || "Erro no login." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
        <h1 className="text-lg font-semibold">Admin · Login</h1>
        <p className="text-xs text-zinc-500 mt-1">Sessão dura 1 hora. “Salvar acesso” mantém o cookie por esse período.</p>

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

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-zinc-600">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="email" />
          </div>
          <div>
            <label className="text-xs text-zinc-600">Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="senha" />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Salvar acesso (1 hora)
          </label>
          <button disabled={busy} className="w-full rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-4 text-xs text-zinc-600">
          <a className="underline" href="/admin/reset">Esqueci minha senha</a>
        </div>
      </div>
    </div>
  );
}
