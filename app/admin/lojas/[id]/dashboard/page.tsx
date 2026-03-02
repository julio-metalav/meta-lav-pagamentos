import Link from "next/link";
import { cookies } from "next/headers";
import { getServerBaseUrl } from "@/lib/http/getServerBaseUrl";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

type DashboardResponse = {
  ok: true;
  loja: {
    id: string;
    nome: string;
    cidade?: string | null;
    uf?: string | null;
    ativo?: boolean | null;
    codigo_condominio?: string | null;
  };
  metrics: {
    total: number;
    available: number;
    pending: number;
    in_use: number;
    error: number;
    stale_pending: number;
  };
  machines: Array<{
    id: string;
    condominio_id: string;
    identificador_local: string | null;
    tipo: string | null;
    ativa: boolean | null;
    gateway_id: string | null;
    gateway_serial: string | null;
    pos_device_id: string | null;
    pos_serial: string | null;
    updated_at: string | null;
  }>;
  status_rows: Array<{
    maquina_id: string;
    identificador_local: string | null;
    tipo: string | null;
    ativa: boolean;
    status: "AVAILABLE" | "PENDING" | "IN_USE" | "ERROR";
    stale_pending: boolean;
  }>;
  prices_by_machine: Record<
    string,
    { current_price_centavos: number | null; has_scheduled_price: boolean; current_rule_id: string | null }
  >;
};

function formatBRLFromCents(cents: number | null) {
  if (cents == null) return "—";
  const v = cents / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(s: string) {
  switch (s) {
    case "AVAILABLE":
      return "Livre";
    case "PENDING":
      return "Pendente";
    case "IN_USE":
      return "Em uso";
    case "ERROR":
      return "Erro";
    default:
      return s;
  }
}

function statusPillClass(s: string) {
  if (s === "AVAILABLE") return "pill border-[var(--state-free)]/40 text-[var(--state-free)] bg-[var(--state-free)]/10";
  if (s === "IN_USE") return "pill border-[var(--meta-cyan)]/40 text-[var(--meta-cyan)] bg-[var(--meta-cyan)]/10";
  if (s === "PENDING") return "pill border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning)]/10";
  return "pill border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger)]/10";
}

function groupKeyFromIdent(ident: string | null) {
  const s = String(ident ?? "").trim();
  if (!s) return "—";
  // Heurística: LAV-01 / SEC-01 => grupo "01"
  const m = s.match(/^(LAV|SEC)[\s\-_]?(.*)$/i);
  if (m && m[2]) return m[2].trim() || s;
  return s;
}

export default async function LojaDashboardPage({ params }: Props) {
  const { id } = await params;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = await getServerBaseUrl();

  let data: DashboardResponse | null = null;
  let apiStatus = 0;
  let apiError: string | null = null;

  try {
    const res = await fetch(`${baseUrl}/api/admin/condominios/${id}/dashboard`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });

    apiStatus = res.status;

    if (res.status === 401) {
      apiError = "Unauthorized";
    } else if (!res.ok) {
      const txt = await res.text().catch(() => "");
      apiError = txt || `HTTP ${res.status}`;
    } else {
      data = (await res.json()) as DashboardResponse;
    }
  } catch (e: unknown) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  if (apiError && apiStatus === 401) {
    return (
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]">
        <div className="font-semibold mb-1">Não autenticado</div>
        <div className="text-[var(--text-secondary)]">
          Faça login em{" "}
          <Link href="/admin/login" className="text-[var(--brand-primary)] hover:underline">
            /admin/login
          </Link>{" "}
          e volte.
        </div>
      </div>
    );
  }

  if (apiError || !data) {
    return (
      <div>
        <div className="mb-4">
          <Link href="/admin/lojas" className="text-[var(--brand-primary)] hover:underline">
            ← Voltar para Lojas
          </Link>
        </div>
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-[var(--foreground)]">
          <div className="font-semibold mb-1">Erro ao carregar dashboard</div>
          <div className="text-[var(--text-secondary)] break-all">{apiError || "Erro desconhecido"}</div>
        </div>
      </div>
    );
  }

  const loja = data.loja;
  const byId = new Map(data.status_rows.map((r) => [r.maquina_id, r]));
  const machines = data.machines.slice();

  // Agrupa LAV/SEC por “máquina base”
  const groups = new Map<
    string,
    {
      key: string;
      items: Array<{
        id: string;
        ident: string | null;
        tipo: string;
        status: "AVAILABLE" | "PENDING" | "IN_USE" | "ERROR";
        stale: boolean;
        price: number | null;
        hasScheduled: boolean;
      }>;
    }
  >();

  for (const m of machines) {
    const tipo = String(m.tipo || "").toLowerCase();
    const sr = byId.get(m.id);
    const s = sr?.status || "AVAILABLE";
    const stale = !!sr?.stale_pending;
    const p = data.prices_by_machine[m.id];
    const groupKey = groupKeyFromIdent(m.identificador_local);

    const entry = {
      id: m.id,
      ident: m.identificador_local,
      tipo: tipo || "—",
      status: s,
      stale,
      price: p?.current_price_centavos ?? null,
      hasScheduled: !!p?.has_scheduled_price,
    };

    const g = groups.get(groupKey) || { key: groupKey, items: [] as any[] };
    g.items.push(entry);
    groups.set(groupKey, g);
  }

  const groupList = Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-sm text-[var(--text-secondary)]">Loja</div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{loja.nome}</h1>
          <div className="text-sm text-[var(--text-secondary)]">
            {loja.cidade || "—"}, {loja.uf || "—"} • {loja.ativo ? "Ativa" : "Inativa"}
            {loja.codigo_condominio ? ` • Código: ${loja.codigo_condominio}` : ""}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            disabled
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] opacity-70 cursor-not-allowed"
            title="Crédito remoto ainda não implementado no backend"
          >
            Crédito remoto (em breve)
          </button>
          <Link
            href={`/admin/lojas/${loja.id}/maquinas`}
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--text-muted)]/20"
          >
            Cadastro de Máquinas
          </Link>
          <Link href="/admin/lojas" className="px-3 py-2 rounded-lg text-[var(--brand-primary)] hover:underline">
            Voltar
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total</div>
          <div className="text-xl font-semibold">{data.metrics.total}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Livre</div>
          <div className="text-xl font-semibold">{data.metrics.available}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Em uso</div>
          <div className="text-xl font-semibold">{data.metrics.in_use}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Pendente</div>
          <div className="text-xl font-semibold">{data.metrics.pending}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Erro</div>
          <div className="text-xl font-semibold">{data.metrics.error}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-[var(--text-secondary)]">Stale</div>
          <div className="text-xl font-semibold">{data.metrics.stale_pending}</div>
        </div>
      </div>

      {/* Grid por Máquina (grupo) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groupList.map((g) => {
          const lav = g.items.find((x) => x.tipo === "lavadora");
          const sec = g.items.find((x) => x.tipo === "secadora");

          return (
            <div key={g.key} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-[var(--foreground)]">Máquina {g.key}</div>
                <Link
                  href={`/admin/lojas/${loja.id}`}
                  className="text-sm text-[var(--text-secondary)] hover:underline"
                  title="Abrir Setup/Wizard"
                >
                  Setup
                </Link>
              </div>

              <div className="space-y-3">
                {lav ? (
                  <div className="flex items-center justify-between gap-3 border border-[var(--border)] rounded-lg p-3">
                    <div>
                      <div className="font-medium">Lavadora</div>
                      <div className="text-sm text-[var(--text-secondary)]">{lav.ident || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {lav.hasScheduled ? (
                        <span className="pill border-[var(--meta-cyan)]/40 text-[var(--meta-cyan)] bg-[var(--meta-cyan)]/10">
                          Preço agendado
                        </span>
                      ) : null}
                      <span className={statusPillClass(lav.status)}>{statusLabel(lav.status)}</span>
                      <div className="text-sm font-semibold min-w-[96px] text-right">{formatBRLFromCents(lav.price)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text-secondary)]">Sem lavadora.</div>
                )}

                {sec ? (
                  <div className="flex items-center justify-between gap-3 border border-[var(--border)] rounded-lg p-3">
                    <div>
                      <div className="font-medium">Secadora</div>
                      <div className="text-sm text-[var(--text-secondary)]">{sec.ident || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sec.hasScheduled ? (
                        <span className="pill border-[var(--meta-cyan)]/40 text-[var(--meta-cyan)] bg-[var(--meta-cyan)]/10">
                          Preço agendado
                        </span>
                      ) : null}
                      <span className={statusPillClass(sec.status)}>{statusLabel(sec.status)}</span>
                      <div className="text-sm font-semibold min-w-[96px] text-right">{formatBRLFromCents(sec.price)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text-secondary)]">Sem secadora.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
