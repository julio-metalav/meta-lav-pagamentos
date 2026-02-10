"use client";

import { FormEvent, useEffect, useState } from "react";

type Condominio = { id: string; nome: string };
type Gateway = { id: string; serial: string; condominio_id: string; created_at?: string };

export default function AdminGatewaysPage() {
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [items, setItems] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [serial, setSerial] = useState("");
  const [condominioId, setCondominioId] = useState("");
  const [search, setSearch] = useState("");
  const [filterCondominioId, setFilterCondominioId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function loadCondominios() {
    const res = await fetch("/api/admin/condominios?limit=100", { method: "GET" });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao carregar condomínios");
    setCondominios(data.items || []);
    if (!condominioId && data?.items?.length) setCondominioId(data.items[0].id);
  }

  async function loadGateways() {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (filterCondominioId) params.set("condominio_id", filterCondominioId);
      const qs = params.toString();
      const res = await fetch(`/api/admin/gateways${qs ? `?${qs}` : ""}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao carregar gateways");
      setItems(data.items || []);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao carregar gateways.");
    } finally {
      setLoading(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!serial.trim() || !condominioId) return;

    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial: serial.trim(), condominio_id: condominioId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao criar gateway");

      setSerial("");
      setMessage("Gateway criado com sucesso.");
      await loadGateways();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao criar gateway.");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    loadCondominios().catch((e) => setMessage(e?.message || "Erro ao carregar condomínios."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGateways();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterCondominioId]);

  function condNome(id: string) {
    return condominios.find((c) => c.id === id)?.nome || id;
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Admin · Gateways</h1>

        <form onSubmit={onCreate} className="rounded-xl bg-white p-4 shadow-sm border border-zinc-200 space-y-3">
          <label className="block text-sm font-medium">Novo gateway</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Serial (ex.: GW-TESTE-001)"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
            />

            <select
              className="rounded-lg border border-zinc-300 px-3 py-2"
              value={condominioId}
              onChange={(e) => setCondominioId(e.target.value)}
            >
              <option value="">Selecione o condomínio</option>
              {condominios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={creating || !serial.trim() || !condominioId}
              className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50"
            >
              {creating ? "Criando..." : "Criar"}
            </button>
          </div>
        </form>

        <div className="rounded-xl bg-white p-4 shadow-sm border border-zinc-200 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Buscar serial"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="rounded-lg border border-zinc-300 px-3 py-2"
              value={filterCondominioId}
              onChange={(e) => setFilterCondominioId(e.target.value)}
            >
              <option value="">Todos os condomínios</option>
              {condominios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>

            <button onClick={loadGateways} className="rounded-lg border border-zinc-300 px-4 py-2">
              Atualizar
            </button>
          </div>

          {message && <p className="text-sm text-zinc-700">{message}</p>}

          {loading ? (
            <p className="text-sm text-zinc-500">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum gateway encontrado.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
              {items.map((g) => (
                <li key={g.id} className="p-3">
                  <p className="font-medium">{g.serial}</p>
                  <p className="text-xs text-zinc-500">Condomínio: {condNome(g.condominio_id)}</p>
                  <p className="text-xs text-zinc-500">{g.id}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
