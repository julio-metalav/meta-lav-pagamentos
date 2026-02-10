"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Condominio = { id: string; nome: string };
type Gateway = { id: string; serial: string; condominio_id: string; created_at?: string };

function badgeClass(kind: "ok" | "muted") {
  return kind === "ok"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export default function AdminGatewaysPage() {
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [items, setItems] = useState<Gateway[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filterCondominioId, setFilterCondominioId] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [condominioId, setCondominioId] = useState("");

  async function loadCondominios() {
    const res = await fetch("/api/admin/condominios?limit=100", { method: "GET" });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao carregar condomínios");
    const list = data.items || [];
    setCondominios(list);
    if (!condominioId && list.length > 0) setCondominioId(list[0].id);
  }

  async function loadGateways() {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (filterCondominioId) params.set("condominio_id", filterCondominioId);

      const res = await fetch(`/api/admin/gateways${params.toString() ? `?${params.toString()}` : ""}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao carregar gateways");
      setItems(data.items || []);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao carregar gateways.");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setSerial("");
    if (!condominioId && condominios.length > 0) setCondominioId(condominios[0].id);
    setModalOpen(true);
    setMessage(null);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!serial.trim() || !condominioId) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial: serial.trim(), condominio_id: condominioId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao criar gateway");

      setModalOpen(false);
      setSerial("");
      setMessage("Gateway criado com sucesso.");
      await loadGateways();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao criar gateway.");
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((g) => g.serial.toLowerCase().includes(q) || g.id.toLowerCase().includes(q));
  }, [items, query]);

  const stats = useMemo(() => {
    const total = items.length;
    const conds = new Set(items.map((i) => i.condominio_id)).size;
    return { total, conds };
  }, [items]);

  function condNome(id: string) {
    return condominios.find((c) => c.id === id)?.nome || id;
  }

  useEffect(() => {
    loadCondominios().catch((e) => setMessage(e?.message || "Erro ao carregar condomínios."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGateways();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCondominioId]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Gateways</h1>
            <p className="text-sm text-zinc-600">Gerencie gateways por condomínio com visão rápida e operação sem fricção.</p>
          </div>
          <button onClick={openCreate} className="rounded-lg bg-zinc-900 text-white px-4 py-2 font-medium hover:bg-zinc-800">
            + Novo gateway
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Total gateways" value={String(stats.total)} />
          <StatCard label="Condomínios" value={String(stats.conds)} />
          <StatCard label="Cobertura" value={stats.total > 0 ? "Ativa" : "—"} tone={stats.total > 0 ? "ok" : "muted"} />
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm border border-zinc-200 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Buscar serial ou ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <select
              className="rounded-lg border border-zinc-300 px-3 py-2"
              value={filterCondominioId}
              onChange={(e) => setFilterCondominioId(e.target.value)}
            >
              <option value="">Todos os condomínios</option>
              {condominios.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            <button onClick={loadGateways} className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-50">
              Atualizar
            </button>
          </div>

          {message && <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{message}</div>}
        </div>

        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Carregando gateways...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-zinc-500">Nenhum gateway encontrado.</p>
              <p className="text-xs text-zinc-400 mt-1">Crie um gateway para começar o provisionamento de máquinas.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Serial</th>
                    <th className="text-left px-4 py-3 font-medium">Condomínio</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredItems.map((g) => (
                    <tr key={g.id} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-3 font-medium">{g.serial}</td>
                      <td className="px-4 py-3 text-zinc-700">{condNome(g.condominio_id)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badgeClass("ok")}`}>
                          ativo
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{g.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white border border-zinc-200 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <h2 className="text-lg font-semibold">Novo gateway</h2>
              <button onClick={() => setModalOpen(false)} className="text-zinc-500 hover:text-zinc-700">✕</button>
            </div>

            <form onSubmit={onCreate} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-zinc-500">Serial</label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  placeholder="GW-TESTE-001"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-zinc-500">Condomínio</label>
                <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={condominioId} onChange={(e) => setCondominioId(e.target.value)}>
                  <option value="">Selecione o condomínio</option>
                  {condominios.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2">Cancelar</button>
                <button type="submit" disabled={saving || !serial.trim() || !condominioId} className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50">
                  {saving ? "Criando..." : "Criar gateway"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "ok" }) {
  const toneClass = tone === "ok" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="rounded-xl bg-white border border-zinc-200 p-4 shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
