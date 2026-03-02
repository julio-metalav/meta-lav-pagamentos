import Link from "next/link";
import { cookies } from "next/headers";
import { getServerBaseUrl } from "@/lib/http/getServerBaseUrl";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

function typeLabel(tipo: string | null | undefined) {
  const t = String(tipo || "").toLowerCase();
  if (t === "lavadora") return "Lavadora";
  if (t === "secadora") return "Secadora";
  return "—";
}

function getFirstParam(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LojaDashboardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const searchText = String(getFirstParam(sp.q) || "").trim();
  const typeFilter = String(getFirstParam(sp.tipo) || "all").toLowerCase();
  const statusFilter = String(getFirstParam(sp.status) || "all").toUpperCase();
  const onlyErrors = String(getFirstParam(sp.only_errors) || "").toLowerCase();
  const errorsOnlyEnabled = onlyErrors === "1" || onlyErrors === "true" || onlyErrors === "on";

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
  const statusById = new Map(data.status_rows.map((r) => [r.maquina_id, r]));
  const priceById = data.prices_by_machine;

  const rows = data.machines.map((m) => {
    const sr = statusById.get(m.id);
    const pr = priceById[m.id] || { current_price_centavos: null, has_scheduled_price: false, current_rule_id: null };
    return {
      m,
      sr,
      pr,
      status: sr?.status || "AVAILABLE",
      stale: !!sr?.stale_pending,
    };
  });

  const searchNeedle = searchText.toLowerCase();
  const rowsFiltered = rows.filter((row) => {
    const ident = String(row.m.identificador_local || "").toLowerCase();
    if (searchNeedle && !ident.includes(searchNeedle)) return false;
    if (typeFilter !== "all" && String(row.m.tipo || "").toLowerCase() !== typeFilter) return false;
    if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
    if (errorsOnlyEnabled && !(row.status === "ERROR" || row.stale)) return false;
    return true;
  });

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

      {/* Filters */}
      <form method="get" action={`/admin/lojas/${loja.id}/dashboard`} className="card p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            name="q"
            defaultValue={searchText}
            placeholder="Buscar por identificador..."
            className="px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-[var(--foreground)]"
          />
          <select
            name="tipo"
            defaultValue={typeFilter}
            className="px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-[var(--foreground)]"
          >
            <option value="all">Todos os tipos</option>
            <option value="lavadora">Lavadora</option>
            <option value="secadora">Secadora</option>
          </select>
          <select
            name="status"
            defaultValue={statusFilter}
            className="px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-[var(--foreground)]"
          >
            <option value="ALL">Todos os status</option>
            <option value="AVAILABLE">Livre</option>
            <option value="IN_USE">Em uso</option>
            <option value="PENDING">Pendente</option>
            <option value="ERROR">Erro</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)]">
            <input type="checkbox" name="only_errors" defaultChecked={errorsOnlyEnabled} />
            <span className="text-sm">Apenas erros</span>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--text-muted)]/20"
            >
              Filtrar
            </button>
            <Link
              href={`/admin/lojas/${loja.id}/dashboard`}
              className="px-3 py-2 rounded-lg text-[var(--text-secondary)] hover:underline"
            >
              Limpar
            </Link>
          </div>
        </div>
      </form>

      {/* Desktop table */}
      <div className="hidden md:block card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--text-secondary)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2">Máquina</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Preço atual</th>
              <th className="px-3 py-2">Agendado</th>
              <th className="px-3 py-2">POS</th>
              <th className="px-3 py-2">Gateway</th>
              <th className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rowsFiltered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-secondary)]">
                  Nenhuma máquina encontrada para os filtros atuais.
                </td>
              </tr>
            ) : (
              rowsFiltered.map((row) => {
                const isInactive = !row.m.ativa;
                const currentPrice = row.pr.current_price_centavos ?? null;
                return (
                  <tr key={row.m.id} className={`border-b border-[var(--border)] ${isInactive ? "opacity-50 grayscale" : ""}`}>
                    <td className="px-3 py-2 font-medium">{row.m.identificador_local || "—"}</td>
                    <td className="px-3 py-2">{typeLabel(row.m.tipo)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={statusPillClass(row.status)}>{statusLabel(row.status)}</span>
                        {row.stale ? (
                          <span className="pill border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger)]/10">STALE</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {currentPrice === null ? (
                        <span className="pill border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning)]/10">Sem preço</span>
                      ) : (
                        <span className="font-semibold">{formatBRLFromCents(currentPrice)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.pr.has_scheduled_price ? (
                        <span className="pill border-[var(--meta-cyan)]/40 text-[var(--meta-cyan)] bg-[var(--meta-cyan)]/10">
                          Agendado
                        </span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.m.pos_serial || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.m.gateway_serial || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          disabled
                          className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] disabled:opacity-70"
                          title="Edição de dispositivos em breve"
                        >
                          Editar dispositivos
                        </button>
                        <button
                          disabled
                          className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] disabled:opacity-70"
                          title="Edição de preço em breve"
                        >
                          Editar preço
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rowsFiltered.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text-secondary)]">Nenhuma máquina encontrada para os filtros atuais.</div>
        ) : (
          rowsFiltered.map((row) => {
            const isInactive = !row.m.ativa;
            const currentPrice = row.pr.current_price_centavos ?? null;
            return (
              <div key={row.m.id} className={`card p-4 ${isInactive ? "opacity-50 grayscale" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{row.m.identificador_local || "—"}</div>
                    <div className="text-sm text-[var(--text-secondary)]">{typeLabel(row.m.tipo)}</div>
                    <div className="text-xs text-[var(--text-secondary)]">POS: {row.m.pos_serial || "—"}</div>
                    <div className="text-xs text-[var(--text-secondary)]">GW: {row.m.gateway_serial || "—"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={statusPillClass(row.status)}>{statusLabel(row.status)}</span>
                    {row.stale ? (
                      <span className="pill border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger)]/10">STALE</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div>
                    {currentPrice === null ? (
                      <span className="pill border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning)]/10">Sem preço</span>
                    ) : (
                      <span className="font-semibold">{formatBRLFromCents(currentPrice)}</span>
                    )}
                  </div>
                  {row.pr.has_scheduled_price ? (
                    <span className="pill border-[var(--meta-cyan)]/40 text-[var(--meta-cyan)] bg-[var(--meta-cyan)]/10">
                      Agendado
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <button
                    disabled
                    className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] disabled:opacity-70"
                  >
                    Editar dispositivos
                  </button>
                  <button
                    disabled
                    className="px-2 py-1 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] disabled:opacity-70"
                  >
                    Editar preço
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
