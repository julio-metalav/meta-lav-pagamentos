"use client";

import { FormEvent, useEffect, useState } from "react";

type Cond = { id: string; nome: string };
type Gw = { id: string; serial: string; condominio_id: string };
type Pos = { id: string; serial: string; condominio_id: string };

type Mq = { id: string; identificador_local: string; tipo: string; gateway_id: string; pos_device_id: string; ativa: boolean; condominio_id: string };

export default function AdminMaquinasPage() {
  const [conds, setConds] = useState<Cond[]>([]);
  const [gws, setGws] = useState<Gw[]>([]);
  const [pos, setPos] = useState<Pos[]>([]);
  const [items, setItems] = useState<Mq[]>([]);

  const [condominioId, setCondominioId] = useState("");
  const [identificadorLocal, setIdentificadorLocal] = useState("");
  const [tipo, setTipo] = useState("lavadora");
  const [gatewayId, setGatewayId] = useState("");
  const [posDeviceId, setPosDeviceId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function loadBase() {
    const c = await (await fetch("/api/admin/condominios?limit=100")).json();
    const condsData = c.items || [];
    setConds(condsData);
    const cid = condominioId || condsData?.[0]?.id || "";
    setCondominioId(cid);

    if (cid) {
      const g = await (await fetch(`/api/admin/gateways?condominio_id=${encodeURIComponent(cid)}`)).json();
      const p = await (await fetch(`/api/admin/pos-devices?condominio_id=${encodeURIComponent(cid)}`)).json();
      const m = await (await fetch(`/api/admin/maquinas?condominio_id=${encodeURIComponent(cid)}`)).json();
      setGws(g.items || []);
      setPos(p.items || []);
      setItems(m.items || []);
      if (!gatewayId && g.items?.[0]?.id) setGatewayId(g.items[0].id);
      if (!posDeviceId && p.items?.[0]?.id) setPosDeviceId(p.items[0].id);
    }
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCondominioChange(v: string) {
    setCondominioId(v);
    const g = await (await fetch(`/api/admin/gateways?condominio_id=${encodeURIComponent(v)}`)).json();
    const p = await (await fetch(`/api/admin/pos-devices?condominio_id=${encodeURIComponent(v)}`)).json();
    const m = await (await fetch(`/api/admin/maquinas?condominio_id=${encodeURIComponent(v)}`)).json();
    setGws(g.items || []);
    setPos(p.items || []);
    setItems(m.items || []);
    setGatewayId(g.items?.[0]?.id || "");
    setPosDeviceId(p.items?.[0]?.id || "");
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);

    const r = await fetch("/api/admin/maquinas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        condominio_id: condominioId,
        identificador_local: identificadorLocal,
        tipo,
        gateway_id: gatewayId,
        pos_device_id: posDeviceId,
      }),
    });

    const j = await r.json();
    if (!r.ok || !j?.ok) {
      setMsg(j?.error_v1?.message || j?.error || "Falha ao criar máquina");
      return;
    }

    setIdentificadorLocal("");
    setMsg("Máquina criada com sucesso.");
    onCondominioChange(condominioId);
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Admin · Máquinas</h1>

        <form onSubmit={onCreate} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-2">
          <select className="rounded-lg border border-[var(--border)] px-3 py-2" value={condominioId} onChange={(e) => onCondominioChange(e.target.value)}>
            <option value="">Condomínio</option>
            {conds.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>

          <input className="rounded-lg border border-[var(--border)] px-3 py-2" placeholder="LAV-01" value={identificadorLocal} onChange={(e) => setIdentificadorLocal(e.target.value)} />

          <select className="rounded-lg border border-[var(--border)] px-3 py-2" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="lavadora">lavadora</option>
            <option value="secadora">secadora</option>
          </select>

          <select className="rounded-lg border border-[var(--border)] px-3 py-2" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
            <option value="">Gateway</option>
            {gws.map((x) => <option key={x.id} value={x.id}>{x.serial}</option>)}
          </select>

          <select className="rounded-lg border border-[var(--border)] px-3 py-2" value={posDeviceId} onChange={(e) => setPosDeviceId(e.target.value)}>
            <option value="">POS Device</option>
            {pos.map((x) => <option key={x.id} value={x.id}>{x.serial}</option>)}
          </select>

          <button className="md:col-span-5 rounded-lg bg-[var(--brand-primary)] text-white py-2 font-bold">Criar máquina</button>
        </form>

        {msg && <p className="text-sm text-[var(--text-secondary)]">{msg}</p>}

        <div className="card p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-secondary)]">
                <th className="py-2">Identificador</th>
                <th>Tipo</th>
                <th>Gateway</th>
                <th>POS</th>
                <th>Ativa</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{m.identificador_local}</td>
                  <td>{m.tipo}</td>
                  <td className="text-xs">{m.gateway_id}</td>
                  <td className="text-xs">{m.pos_device_id}</td>
                  <td>{m.ativa ? "sim" : "não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
