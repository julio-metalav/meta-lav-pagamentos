"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AlertRoute = {
  id: string;
  enabled: boolean;
  event_code: "all" | "stale_pending_cycles" | "expired_backlog_high" | "monitor_error";
  channel: "whatsapp" | "telegram" | "email" | "discord";
  target: string;
  severity_min: "info" | "warning" | "critical";
  dedupe_window_sec: number;
  created_at?: string;
  updated_at?: string;
};

const EVENT_CODES: AlertRoute["event_code"][] = ["all", "stale_pending_cycles", "expired_backlog_high", "monitor_error"];
const CHANNELS: AlertRoute["channel"][] = ["whatsapp", "telegram", "email", "discord"];
const SEVERITIES: AlertRoute["severity_min"][] = ["info", "warning", "critical"];

function badgeClass(kind: "ok" | "warn" | "danger" | "muted") {
  switch (kind) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "warn":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "danger":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
}

function severityBadge(severity: AlertRoute["severity_min"]) {
  if (severity === "critical") return badgeClass("danger");
  if (severity === "warning") return badgeClass("warn");
  return badgeClass("muted");
}

function eventLabel(eventCode: AlertRoute["event_code"]) {
  const map: Record<AlertRoute["event_code"], string> = {
    all: "Todos os eventos",
    stale_pending_cycles: "Ciclos stale",
    expired_backlog_high: "Backlog expirado alto",
    monitor_error: "Erro de monitor",
  };
  return map[eventCode] || eventCode;
}

export default function AdminAlertRoutesPage() {
  const [items, setItems] = useState<AlertRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingRouteId, setTestingRouteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [filterChannel, setFilterChannel] = useState<"all" | AlertRoute["channel"]>("all");
  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [eventCode, setEventCode] = useState<AlertRoute["event_code"]>("all");
  const [channel, setChannel] = useState<AlertRoute["channel"]>("whatsapp");
  const [target, setTarget] = useState("");
  const [severityMin, setSeverityMin] = useState<AlertRoute["severity_min"]>("warning");
  const [dedupeWindowSec, setDedupeWindowSec] = useState(900);

  async function loadItems() {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filterEnabled === "enabled") params.set("enabled", "true");
      if (filterEnabled === "disabled") params.set("enabled", "false");
      if (filterChannel !== "all") params.set("channel", filterChannel);

      const res = await fetch(`/api/admin/alert-routes?${params.toString()}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao listar rotas de alerta");
      setItems(data.items || []);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao carregar alert routes.");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setEnabled(true);
    setEventCode("all");
    setChannel("whatsapp");
    setTarget("");
    setSeverityMin("warning");
    setDedupeWindowSec(900);
  }

  function openCreate() {
    resetForm();
    setModalOpen(true);
    setMessage(null);
  }

  function openEdit(item: AlertRoute) {
    setEditingId(item.id);
    setEnabled(item.enabled);
    setEventCode(item.event_code);
    setChannel(item.channel);
    setTarget(item.target);
    setSeverityMin(item.severity_min);
    setDedupeWindowSec(item.dedupe_window_sec);
    setModalOpen(true);
    setMessage(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const payload = {
        enabled,
        event_code: eventCode,
        channel,
        target: target.trim(),
        severity_min: severityMin,
        dedupe_window_sec: Number(dedupeWindowSec),
      };

      if (!payload.target) throw new Error("target é obrigatório");

      const url = editingId ? `/api/admin/alert-routes/${editingId}` : "/api/admin/alert-routes";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao salvar rota");

      setMessage(editingId ? "Rota atualizada com sucesso." : "Rota criada com sucesso.");
      setModalOpen(false);
      resetForm();
      await loadItems();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao salvar rota.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Remover esta rota de alerta?")) return;
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/alert-routes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao remover rota");
      setMessage("Rota removida.");
      if (editingId === id) {
        setModalOpen(false);
        resetForm();
      }
      await loadItems();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao remover rota.");
    }
  }

  async function toggleEnabled(item: AlertRoute) {
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/alert-routes/${item.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao alternar status");
      setMessage(`Rota ${!item.enabled ? "ativada" : "desativada"}.`);
      await loadItems();
    } catch (e: any) {
      setMessage(e?.message || "Erro ao alternar status.");
    }
  }

  async function testRoute(item: AlertRoute) {
    setTestingRouteId(item.id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/alert-routes/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ route_id: item.id, actor: "admin-ui" }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error_v1?.message || data?.error || "Falha ao testar rota");

      const mode = data?.simulated ? "simulado" : "real";
      setMessage(`Teste (${mode}) executado em ${item.channel}/${item.target}: ${data?.dispatch_status || "ok"}.`);
    } catch (e: any) {
      setMessage(e?.message || "Erro ao testar rota.");
    } finally {
      setTestingRouteId(null);
    }
  }

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      return (
        r.target.toLowerCase().includes(q) ||
        r.channel.toLowerCase().includes(q) ||
        r.event_code.toLowerCase().includes(q) ||
        r.severity_min.toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((r) => r.enabled).length;
    const critical = items.filter((r) => r.severity_min === "critical").length;
    const channels = new Set(items.map((r) => r.channel)).size;
    return { total, active, critical, channels };
  }, [items]);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEnabled, filterChannel]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Alert Routes</h1>
            <p className="text-sm text-zinc-600">Configure destinos de alerta com clareza operacional e zero hardcode.</p>
          </div>
          <button onClick={openCreate} className="rounded-lg bg-zinc-900 text-white px-4 py-2 font-medium hover:bg-zinc-800">
            + Nova rota
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={String(stats.total)} />
          <StatCard label="Ativas" value={String(stats.active)} tone="ok" />
          <StatCard label="Críticas" value={String(stats.critical)} tone="danger" />
          <StatCard label="Canais" value={String(stats.channels)} />
        </div>

        <div className="rounded-xl bg-white border border-zinc-200 p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="Buscar por canal, destino, evento..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <select className="rounded-lg border border-zinc-300 px-3 py-2" value={filterEnabled} onChange={(e) => setFilterEnabled(e.target.value as any)}>
              <option value="all">Status: todos</option>
              <option value="enabled">Status: ativos</option>
              <option value="disabled">Status: inativos</option>
            </select>

            <select className="rounded-lg border border-zinc-300 px-3 py-2" value={filterChannel} onChange={(e) => setFilterChannel(e.target.value as any)}>
              <option value="all">Canal: todos</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <button onClick={loadItems} className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-50">
              Atualizar
            </button>
          </div>

          {message && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{message}</div>
          )}
        </div>

        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Carregando rotas...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-zinc-500">Nenhuma rota encontrada.</p>
              <p className="text-xs text-zinc-400 mt-1">Crie a primeira rota para começar a receber alertas operacionais.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Evento</th>
                    <th className="text-left px-4 py-3 font-medium">Canal / Destino</th>
                    <th className="text-left px-4 py-3 font-medium">Severidade</th>
                    <th className="text-left px-4 py-3 font-medium">Dedupe</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-4 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredItems.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-900">{eventLabel(r.event_code)}</p>
                        <p className="text-xs text-zinc-500">{r.event_code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badgeClass("muted")}`}>{r.channel}</span>
                          <span className="text-zinc-700">{r.target}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${severityBadge(r.severity_min)}`}>
                          {r.severity_min}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">{r.dedupe_window_sec}s</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleEnabled(r)}
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${r.enabled ? badgeClass("ok") : badgeClass("muted")}`}
                        >
                          {r.enabled ? "Ativo" : "Inativo"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => testRoute(r)}
                            disabled={testingRouteId === r.id}
                            className="rounded-md border border-blue-300 text-blue-700 px-3 py-1.5 text-xs hover:bg-blue-50 disabled:opacity-50"
                          >
                            {testingRouteId === r.id ? "Testando..." : "Testar"}
                          </button>
                          <button onClick={() => openEdit(r)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50">Editar</button>
                          <button onClick={() => onDelete(r.id)} className="rounded-md border border-red-300 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50">Remover</button>
                        </div>
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
              <h2 className="text-lg font-semibold">{editingId ? "Editar rota" : "Nova rota"}</h2>
              <button onClick={() => setModalOpen(false)} className="text-zinc-500 hover:text-zinc-700">✕</button>
            </div>

            <form onSubmit={onSubmit} className="p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Evento</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={eventCode} onChange={(e) => setEventCode(e.target.value as AlertRoute["event_code"])}>
                    {EVENT_CODES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Canal</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={channel} onChange={(e) => setChannel(e.target.value as AlertRoute["channel"])}>
                    {CHANNELS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-500">Destino</label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  placeholder="+55..., chat_id, email..."
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Severidade mínima</label>
                  <select className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2" value={severityMin} onChange={(e) => setSeverityMin(e.target.value as AlertRoute["severity_min"])}>
                    {SEVERITIES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-500">Dedupe (segundos)</label>
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                    value={dedupeWindowSec}
                    onChange={(e) => setDedupeWindowSec(Number(e.target.value || 0))}
                  />
                </div>

                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 w-full justify-center">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    <span>Ativa</span>
                  </label>
                </div>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-zinc-900 text-white px-4 py-2 disabled:opacity-50">
                  {saving ? "Salvando..." : editingId ? "Salvar" : "Criar rota"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "ok" | "danger" }) {
  const toneMap: Record<string, string> = {
    muted: "text-zinc-900",
    ok: "text-emerald-700",
    danger: "text-red-700",
  };

  return (
    <div className="rounded-xl bg-white border border-zinc-200 p-4 shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}
