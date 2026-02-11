"use client";

import { useMemo, useState } from "react";

export default function ResetPage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("token") || "";
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg("Se o email existir, enviamos um link de reset.");
    } catch (err: any) {
      setMsg(err?.message || "Erro.");
    } finally {
      setBusy(false);
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
      window.location.href = "/admin";
    } catch (err: any) {
      setMsg(err?.message || "Erro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
        <h1 className="text-lg font-semibold">Reset de senha</h1>
        {msg && <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">{msg}</div>}

        {!token ? (
          <form className="mt-4 space-y-3" onSubmit={requestReset}>
            <div>
              <label className="text-xs text-zinc-600">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
            </div>
            <button disabled={busy} className="w-full rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {busy ? "Enviando..." : "Enviar link"}
            </button>
          </form>
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
