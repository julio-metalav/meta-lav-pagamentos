"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Condominio = {
  id: string;
  nome: string;
};

export default function AdminCondominiosPage() {
  const [items, setItems] = useState<Condominio[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nome, setNome] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const query = useMemo(() => search.trim(), [search]);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const url = query ? `/api/admin/condominios?search=${encodeURIComponent(query)}` : "/api/admin/condominios";
      const res = await fetch(url, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao carregar");
      setItems(data.items || []);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao carregar lojas.");
    } finally {
      setLoading(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const nomeTrim = nome.trim();
    if (!nomeTrim) return;

    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/condominios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: nomeTrim }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao criar");

      setNome("");
      setMessage("Loja criado com sucesso.");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao criar loja.");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Admin · Lojas</h1>

        <form onSubmit={onCreate} className="rounded-xl bg-white p-4 shadow-sm border border-zinc-200 space-y-3">
          <label className="block text-sm font-medium">Novo loja</label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Ex.: Loja Teste Pagamentos"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <button
              type="submit"
              disabled={creating || !nome.trim()}
              className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50"
            >
              {creating ? "Criando..." : "Criar"}
            </button>
          </div>
        </form>

        <div className="rounded-xl bg-white p-4 shadow-sm border border-zinc-200 space-y-3">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Buscar por nome"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button onClick={load} className="rounded-lg border border-zinc-300 px-4 py-2">
              Atualizar
            </button>
          </div>

          {message && <p className="text-sm text-zinc-700">{message}</p>}

          {loading ? (
            <p className="text-sm text-zinc-500">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum loja encontrado.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
              {items.map((c) => (
                <li key={c.id} className="p-3">
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-zinc-500">{c.id}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
