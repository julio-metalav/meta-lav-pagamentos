"use client";

import { useMemo, useState } from "react";

export default function ActivatePage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("token") || "";
  }, []);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: any) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao ativar");
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
        <h1 className="text-lg font-semibold">Ativar acesso</h1>
        <p className="text-xs text-zinc-500 mt-1">Defina uma senha (mín 6, letra+número+especial).</p>
        {msg && <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">{msg}</div>}
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-zinc-600">Nova senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <button disabled={busy} className="w-full rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
            {busy ? "Salvando..." : "Ativar"}
          </button>
        </form>
      </div>
    </div>
  );
}
