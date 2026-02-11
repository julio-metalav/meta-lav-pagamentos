"use client";

import { useEffect, useMemo, useState } from "react";
import { PERMISSIONS } from "@/lib/admin/permissions";

type UserItem = { id: string; email: string; name: string | null; enabled: boolean; status: string; created_at: string; last_login_at: string | null };

export default function AdminUsersPage() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => items.find((x) => x.id === selectedId) || null, [items, selectedId]);

  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [savingPerms, setSavingPerms] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/users");
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao carregar");
      setItems(j.items || []);
    } catch (e: any) {
      setMsg(e?.message || "Erro.");
    } finally {
      setLoading(false);
    }
  }

  async function createUser(e: any) {
    e.preventDefault();
    setCreating(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao criar");
      setMsg("Convite enviado (via email) — verifique outbox.");
      setEmail("");
      setName("");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Erro.");
    } finally {
      setCreating(false);
    }
  }

  async function savePermissions() {
    if (!selectedId) return;
    setSavingPerms(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${selectedId}/permissions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed: Array.from(allowed.values()) }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao salvar permissões");
      setMsg("Permissões salvas.");
    } catch (e: any) {
      setMsg(e?.message || "Erro.");
    } finally {
      setSavingPerms(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="bg-slate-700 text-white px-6 py-4 shadow-sm">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <h1 className="text-xl font-semibold">Admin · Usuários</h1>
          <button onClick={load} className="rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">Atualizar</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6 space-y-4">
        {msg && <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">{msg}</div>}

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="font-medium">Convidar usuário</h2>
          <form onSubmit={createUser} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border px-3 py-2 text-sm" placeholder="email" />
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border px-3 py-2 text-sm" placeholder="nome (opcional)" />
            <button disabled={creating} className="rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {creating ? "Enviando..." : "Enviar convite"}
            </button>
          </form>
          <p className="text-xs text-zinc-500 mt-2">O usuário recebe um link para definir a senha.</p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
              <h2 className="font-medium">Usuários</h2>
              <span className="text-xs text-zinc-500">{loading ? "carregando..." : `${items.length}`}</span>
            </header>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {items.map((u) => (
                    <tr key={u.id} className={selectedId === u.id ? "bg-amber-50" : ""}>
                      <td className="px-3 py-2">
                        <button className="text-left w-full" onClick={() => setSelectedId(u.id)}>
                          <p className="font-medium">{u.email}</p>
                          <p className="text-xs text-zinc-500">{u.name || "—"}</p>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs">{u.enabled ? u.status : "disabled"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
              <h2 className="font-medium">Permissões (override)</h2>
              <p className="text-xs text-zinc-500">Selecionado: {selected ? selected.email : "—"}</p>
            </header>
            <div className="p-4 space-y-3">
              {!selected ? (
                <p className="text-sm text-zinc-500">Selecione um usuário para editar permissões.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PERMISSIONS.map((p) => (
                      <label key={p.code} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={allowed.has(p.code)}
                          onChange={(e) => {
                            const next = new Set(Array.from(allowed.values()));
                            if (e.target.checked) next.add(p.code);
                            else next.delete(p.code);
                            setAllowed(next);
                          }}
                        />
                        <span>{p.name}</span>
                        <span className="text-xs text-zinc-400">({p.code})</span>
                      </label>
                    ))}
                  </div>
                  <button
                    disabled={savingPerms}
                    onClick={savePermissions}
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {savingPerms ? "Salvando..." : "Salvar permissões"}
                  </button>
                  <p className="text-xs text-zinc-500">
                    Nota: este é um override por usuário. O Gestor tem permissões por role; para admins abaixo, você pode conceder apenas o necessário.
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
