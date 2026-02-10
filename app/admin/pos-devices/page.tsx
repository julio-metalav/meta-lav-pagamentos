"use client";

import { FormEvent, useEffect, useState } from "react";

type Cond = { id: string; nome: string };
type Pos = { id: string; serial: string; condominio_id: string };

export default function AdminPosDevicesPage() {
  const [conds, setConds] = useState<Cond[]>([]);
  const [items, setItems] = useState<Pos[]>([]);
  const [serial, setSerial] = useState("");
  const [condominioId, setCondominioId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function loadConds() {
    const r = await fetch("/api/admin/condominios?limit=100");
    const j = await r.json();
    setConds(j.items || []);
    if (!condominioId && j.items?.[0]?.id) setCondominioId(j.items[0].id);
  }

  async function loadItems() {
    const r = await fetch("/api/admin/pos-devices");
    const j = await r.json();
    setItems(j.items || []);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/admin/pos-devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serial, condominio_id: condominioId }),
    });
    const j = await r.json();
    if (!r.ok || !j?.ok) {
      setMsg(j?.error_v1?.message || j?.error || "Falha ao criar POS");
      return;
    }
    setSerial("");
    setMsg("POS criado com sucesso.");
    loadItems();
  }

  useEffect(() => {
    loadConds();
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Admin · POS Devices</h1>
        <form onSubmit={onCreate} className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className="rounded-lg border border-[var(--border)] px-3 py-2" placeholder="POS-01" value={serial} onChange={(e) => setSerial(e.target.value)} />
          <select className="rounded-lg border border-[var(--border)] px-3 py-2" value={condominioId} onChange={(e) => setCondominioId(e.target.value)}>
            <option value="">Condomínio</option>
            {conds.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <button className="rounded-lg bg-[var(--brand-primary)] text-white py-2 font-bold">Criar POS</button>
        </form>
        {msg && <p className="text-sm text-[var(--text-secondary)]">{msg}</p>}
        <div className="card p-4">
          <ul className="divide-y divide-[var(--border)]">
            {items.map((x) => <li key={x.id} className="py-2 text-sm"><strong>{x.serial}</strong> · condominio={x.condominio_id}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
