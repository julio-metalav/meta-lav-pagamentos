"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Cond = { id: string; nome: string };
type Gw = { id: string; serial: string; condominio_id: string };
type Pos = { id: string; serial: string; condominio_id: string };

type Mq = {
  id: string;
  identificador_local: string;
  tipo: string;
  gateway_id: string;
  pos_device_id: string;
  ativa: boolean;
  condominio_id: string;
};

function badgeClass(kind: "ok" | "warn" | "muted") {
  if (kind === "ok") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (kind === "warn") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export default function AdminMaquinasPage() {
  const [conds, setConds] = useState<Cond[]>([]);
  const [gws, setGws] = useState<Gw[]>([]);
  const [pos, setPos] = useState<Pos[]>([]);
  const [items, setItems] = useState<Mq[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filterTipo, setFilterTipo] = useState<"all" | "lavadora" | "secadora">("all");

  const [condominioId, setCondominioId] = useState("");
  const [identificadorLocal, setIdentificadorLocal] = useState("");
  const [tipo, setTipo] = useState("lavadora");
  const [gatewayId, setGatewayId] = useState("");
  const [posDeviceId, setPosDeviceId] = useState("");

  const [modalOpen, setModalOpen] = useState(false);

  async function loadCondominios() {
    const c = await (await fetch("/api/admin/condominios?limit=100")).json();
    if (!c?.ok) throw new Error(c?.error_v1?.message || c?.error || "Falha ao carregar condomínios");
    const condsData = c.items || [];
    setConds(condsData);
    const cid = condominioId || condsData?.[0]?.id || "";
    if (!condominioId) setCondominioId(cid);
    return cid;
  }

  async function loadByCondominio(cid: string) {
    if (!cid) return;
    setLoading(true);
    setMsg(null);
    try {
      const g = await (await fetch(`/api/admin/gateways?condominio_id=${encodeURIComponent(cid)}`)).json();
      const p = await (await fetch(`/api/admin/pos-devices?condominio_id=${encodeURIComponent(cid)}`)).json();
      const m = await (await fetch(`/api/admin/maquinas?condominio_id=${encodeURIComponent(cid)}`)).json();

      if (!g?.ok) throw new Error(g?.error_v1?.message || g?.error || "Falha ao carregar gateways");
      if (!p?.ok) throw new Error(p?.error_v1?.message || p?.error || "Falha ao carregar POS devices");
      if (!m?.ok) throw new Error(m?.error_v1?.message || m?.error || "Falha ao carregar máquinas");

      const gItems = g.items || [];
      const pItems = p.items || [];
      setGws(gItems);
      setPos(pItems);
      setItems(m.items || []);

      if (!gatewayId && gItems[0]?.id) setGatewayId(gItems[0].id);
      if (!posDeviceId && pItems[0]?.id) setPosDeviceId(pItems[0].id);
    } catch (e: any) {
      setMsg(e?.message || "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setIdentificadorLocal("");
    setTipo("lavadora");
    if (!gatewayId && gws[0]?.id) setGatewayId(gws[0].id);
    if (!posDeviceId && pos[0]?.id) setPosDeviceId(pos[0].id);
    setModalOpen(true);
    setMsg(null);
  }

  async function onCondominioChange(v: string) {
    setCondominioId(v);
    await loadByCondominio(v);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);

    try {
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
      if (!r.ok || !j?.ok) throw new Error(j?.error_v1?.message || j?.error || "Falha ao criar máquina");

      setModalOpen(false);
      setIdentificadorLocal("");
      setMsg("Máquina criada com sucesso.");
      await loadByCondominio(condominioId);
    } catch (e: any) {
      setMsg(e?.message || "Erro ao criar máquina.");
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filterTipo !== "all" && m.tipo !== filterTipo) return false;
      if (!q) return true;
      return (
        m.identificador_local.toLowerCase().includes(q) ||
        m.gateway_id.toLowerCase().includes(q) ||
        m.pos_device_id.toLowerCase().includes(q)
      );
    });
  }, [items, query, filterTipo]);

  const stats = useMemo(() => {
    const total = items.length;
    const lavadoras = items.filter((x) => x.tipo === "lavadora").length;
    const secadoras = items.filter((x) => x.tipo === "secadora").length;
    const ativas = items.filter((x) => x.ativa).length;
    return { total, lavadoras, secadoras, ativas };
  }, [items]);

  useEffect(() => {
    (async () => {
      try {
        const cid = await loadCondominios();
        if (cid) await loadByCondominio(cid);
      } catch (e: any) {
        setMsg(e?.message || "Erro inicial de carregamento.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Máquinas</h1>
            <p className="text-sm text-zinc-600">Cadastro de lavadoras/secadoras com vínculo claro de gateway e POS.</p>
          </div>
          <button onClick={openCreate} className="rounded-lg bg-zinc-900 text-white px-4 py-2 font-medium hover:bg-zinc-800">
            + Nova máquina
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={String(stats.total)} />
          <StatCard label="Lavadoras" value={String(stats.lavadoras)} />
          <StatCard label="Secadoras" value={String(stats.secadoras)} />
          <StatCard label="Ativas" value={String(stats.ativas)} tone="ok" />
        </div>

        <div className="rounded-xl bg-white p-4 border border-zinc-200 shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select className="rounded-lg border border-zinc-300 px-3 py-2" value={condominioId} onChange={(e) => onCondominioChange(e.target.value)}>
              <option value="">Condomínio</option>
              {conds.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            <input
              className="rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Buscar identificador/gateway/pos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <select className="rounded-lg border border-zinc-300 px-3 py-2" value={filterTipo} onChange={(e) => setFilterTipo(e.target.value as any)}>
              <option value="all">Tipo: todos</option>
              <option value="lavadora">lavadora</option>
              <option value="secadora">secadora</option>
            </select>

            <button onClick={() => loadByCondominio(condominioId)} className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-50">
              Atualizar
            </button>
          </div>

          {msg && <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{msg}</div>}
        </div>

        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Carregando máquinas...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-zinc-500">Nenhuma máquina encontrada.</p>
              <p className="text-xs text-zinc-400 mt-1">Crie a primeira máquina para habilitar operação no condomínio.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Identificador</th>
                    <th className="text-left px-4 py-3 font-medium">Tipo</th>
                    <th className="text-left px-4 py-3 font-medium">Gateway</th>
                    <th className="text-left px-4 py-3 font-medium">POS</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredItems.map((m) => (
                    <tr key={m.id} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-3 font-medium">{m.identificador_local}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${m.tipo === "secadora" ? badgeClass("warn") : badgeClass("muted")}`}>
                          {m.tipo}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{m.gateway_id}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{m.pos_device_id}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${m.ativa ? badgeClass("ok") : badgeClass("muted")}`}>
                          {m.ativa ? "ativa" : "inativa"}
                        </span>
                      </td>
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
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-zinc-200 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <h2 className="text-lg font-semibold">Nova máquina</h2>
              <button onClick={() => setModalOpen(false)} className="text-zinc-500 hover:text-zinc-700">✕</button>
            </div>

            <form onSubmit={onCreate} className="p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Condomínio</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={condominioId} onChange={(e) => onCondominioChange(e.target.value)}>
                    <option value="">Condomínio</option>
                    {conds.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-500">Identificador local</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                    placeholder="LAV-01"
                    value={identificadorLocal}
                    onChange={(e) => setIdentificadorLocal(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Tipo</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="lavadora">lavadora</option>
                    <option value="secadora">secadora</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-500">Gateway</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
                    <option value="">Selecione</option>
                    {gws.map((x) => (
                      <option key={x.id} value={x.id}>{x.serial}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-500">POS Device</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={posDeviceId} onChange={(e) => setPosDeviceId(e.target.value)}>
                    <option value="">Selecione</option>
                    {pos.map((x) => (
                      <option key={x.id} value={x.id}>{x.serial}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2">Cancelar</button>
                <button
                  type="submit"
                  disabled={saving || !condominioId || !identificadorLocal.trim() || !gatewayId || !posDeviceId}
                  className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50"
                >
                  {saving ? "Criando..." : "Criar máquina"}
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
