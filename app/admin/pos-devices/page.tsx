"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Cond = { id: string; nome: string };
type Pos = { id: string; serial: string; condominio_id: string };

function badgeClass(kind: "ok" | "muted") {
  return kind === "ok"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export default function AdminPosDevicesPage() {
  const [conds, setConds] = useState<Cond[]>([]);
  const [items, setItems] = useState<Pos[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filterCondominioId, setFilterCondominioId] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [condominioId, setCondominioId] = useState("");

  async function loadConds() {
    const r = await fetch("/api/admin/condominios?limit=100");
    const j = await r.json();
    if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao carregar condomínios");
    const list = j.items || [];
    setConds(list);
    if (!condominioId && list[0]?.id) setCondominioId(list[0].id);
  }

  async function loadItems() {
    setLoading(true);
    setMsg(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (filterCondominioId) params.set("condominio_id", filterCondominioId);

      const r = await fetch(`/api/admin/pos-devices${params.toString() ? `?${params.toString()}` : ""}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao carregar POS devices");
      setItems(j.items || []);
    } catch (e: any) {
      setMsg(e?.message || "Erro ao carregar POS devices.");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setSerial("");
    if (!condominioId && conds[0]?.id) setCondominioId(conds[0].id);
    setModalOpen(true);
    setMsg(null);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const r = await fetch("/api/admin/pos-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial: serial.trim(), condominio_id: condominioId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao criar POS");
      setModalOpen(false);
      setSerial("");
      setMsg("POS criado com sucesso.");
      await loadItems();
    } catch (e: any) {
      setMsg(e?.message || "Erro ao criar POS.");
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => x.serial.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  }, [items, query]);

  const stats = useMemo(() => {
    const total = items.length;
    const condCount = new Set(items.map((i) => i.condominio_id)).size;
    return { total, condCount };
  }, [items]);

  function condNome(id: string) {
    return conds.find((c) => c.id === id)?.nome || id;
  }

  useEffect(() => {
    loadConds().catch((e) => setMsg(e?.message || "Erro ao carregar condomínios."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCondominioId]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">POS Devices</h1>
            <p className="text-sm text-zinc-600">Gestão clara dos terminais POS por condomínio, com operação rápida.</p>
          </div>
          <button onClick={openCreate} className="rounded-lg bg-zinc-900 text-white px-4 py-2 font-medium hover:bg-zinc-800">
            + Novo POS
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Total POS" value={String(stats.total)} />
          <StatCard label="Condomínios" value={String(stats.condCount)} />
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
              {conds.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            <button onClick={loadItems} className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-50">
              Atualizar
            </button>
          </div>

          {msg && <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{msg}</div>}
        </div>

        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Carregando POS devices...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-zinc-500">Nenhum POS encontrado.</p>
              <p className="text-xs text-zinc-400 mt-1">Crie um terminal POS para iniciar o fluxo presencial.</p>
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
                  {filteredItems.map((x) => (
                    <tr key={x.id} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-3 font-medium">{x.serial}</td>
                      <td className="px-4 py-3 text-zinc-700">{condNome(x.condominio_id)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badgeClass("ok")}`}>
                          ativo
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{x.id}</td>
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
              <h2 className="text-lg font-semibold">Novo POS device</h2>
              <button onClick={() => setModalOpen(false)} className="text-zinc-500 hover:text-zinc-700">✕</button>
            </div>

            <form onSubmit={onCreate} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-zinc-500">Serial</label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  placeholder="POS-TESTE-001"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-zinc-500">Condomínio</label>
                <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={condominioId} onChange={(e) => setCondominioId(e.target.value)}>
                  <option value="">Selecione o condomínio</option>
                  {conds.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2">Cancelar</button>
                <button type="submit" disabled={saving || !serial.trim() || !condominioId} className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50">
                  {saving ? "Criando..." : "Criar POS"}
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
