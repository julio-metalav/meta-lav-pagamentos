"use client";

import { useEffect, useMemo, useState } from "react";
import { PERMISSIONS } from "@/lib/admin/permissions";

type UserItem = { id: string; email: string; name: string | null; enabled: boolean; status: string; created_at: string; last_login_at: string | null };

type Notice = { tone: "neutral" | "success" | "error"; text: string } | null;

type PermGroup = { key: string; title: string; items: Array<(typeof PERMISSIONS)[number]> };

function groupPermissions(): PermGroup[] {
  const groups: Array<{ key: string; title: string; match: (code: string) => boolean }> = [
    { key: "dashboard", title: "Dashboard", match: (c) => c.startsWith("dashboard.") },
    { key: "alerts", title: "Alertas", match: (c) => c.startsWith("alerts.") },
    { key: "users", title: "Usuários", match: (c) => c.startsWith("admin.users.") },
    { key: "gateways", title: "Gateways", match: (c) => c.startsWith("admin.gateways.") },
    { key: "pos", title: "POS Devices", match: (c) => c.startsWith("admin.pos_devices.") },
    { key: "maquinas", title: "Máquinas", match: (c) => c.startsWith("admin.maquinas.") },
    { key: "condominios", title: "Lojas", match: (c) => c.startsWith("admin.condominios.") },
  ];

  return groups
    .map((g) => ({ key: g.key, title: g.title, items: PERMISSIONS.filter((p) => g.match(p.code)) }))
    .filter((g) => g.items.length > 0);
}

export default function AdminUsersPage() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => items.find((x) => x.id === selectedId) || null, [items, selectedId]);

  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);

  const permGroups = useMemo(() => groupPermissions(), []);
  const selectedCount = allowed.size;

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/users");
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao carregar");
      setItems(j.items || []);
    } catch (e: any) {
      setMsg({ tone: "error", text: e?.message || "Erro ao carregar usuários." });
    } finally {
      setLoading(false);
    }
  }

  async function loadUserPermissions(userId: string) {
    setLoadingPerms(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/permissions`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao carregar permissões");
      setAllowed(new Set((j.allowed || []).map((x: string) => String(x))));
    } catch (e: any) {
      setAllowed(new Set());
      setMsg({ tone: "error", text: e?.message || "Erro ao carregar permissões do usuário." });
    } finally {
      setLoadingPerms(false);
    }
  }

  async function onSelectUser(id: string) {
    setSelectedId(id);
    await loadUserPermissions(id);
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
      setMsg({ tone: "success", text: "Convite enviado. Link de ativação enfileirado no outbox." });
      setEmail("");
      setName("");
      await load();
    } catch (e: any) {
      setMsg({ tone: "error", text: e?.message || "Erro ao criar usuário." });
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
      setMsg({ tone: "success", text: `Permissões salvas (${allowed.size} selecionadas).` });
    } catch (e: any) {
      setMsg({ tone: "error", text: e?.message || "Erro ao salvar permissões." });
    } finally {
      setSavingPerms(false);
    }
  }

  function togglePermission(code: string, checked: boolean) {
    const next = new Set(Array.from(allowed.values()));
    if (checked) next.add(code);
    else next.delete(code);
    setAllowed(next);
  }

  function selectAll() {
    setAllowed(new Set(PERMISSIONS.map((p) => p.code)));
  }

  function clearAll() {
    setAllowed(new Set());
  }

  function selectModule(group: PermGroup) {
    const next = new Set(Array.from(allowed.values()));
    for (const p of group.items) next.add(p.code);
    setAllowed(next);
  }

  function clearModule(group: PermGroup) {
    const next = new Set(Array.from(allowed.values()));
    for (const p of group.items) next.delete(p.code);
    setAllowed(next);
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
        {msg && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              msg.tone === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : msg.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            {msg.text}
          </div>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="font-medium">Convidar usuário</h2>
          <form onSubmit={createUser} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border px-3 py-2 text-sm" placeholder="email" />
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border px-3 py-2 text-sm" placeholder="nome (opcional)" />
            <button disabled={creating} className="rounded-md bg-slate-700 text-white py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {creating ? "Enviando..." : "Enviar convite"}
            </button>
          </form>
          <p className="text-xs text-zinc-500 mt-2">O usuário recebe link para definir senha (via outbox/dispatcher).</p>
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
                        <button className="text-left w-full" onClick={() => onSelectUser(u.id)}>
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
              ) : loadingPerms ? (
                <p className="text-sm text-zinc-500">Carregando permissões...</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" onClick={selectAll} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50">Selecionar tudo</button>
                    <button type="button" onClick={clearAll} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50">Limpar tudo</button>
                    <span className="text-xs text-zinc-500">{selectedCount} permissões selecionadas</span>
                  </div>

                  <div className="space-y-3">
                    {permGroups.map((group) => (
                      <div key={group.key} className="rounded-lg border border-zinc-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <h3 className="text-sm font-medium">{group.title}</h3>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => selectModule(group)} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">Selecionar módulo</button>
                            <button type="button" onClick={() => clearModule(group)} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">Limpar módulo</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {group.items.map((p) => (
                            <label key={p.code} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={allowed.has(p.code)}
                                onChange={(e) => togglePermission(p.code, e.target.checked)}
                              />
                              <span>{p.name}</span>
                              <span className="text-xs text-zinc-400">({p.code})</span>
                            </label>
                          ))}
                        </div>
                      </div>
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
                    Override por usuário: o Gestor pode delegar granularmente por módulo/tela para admins abaixo.
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
