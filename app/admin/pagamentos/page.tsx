import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type PagamentosPageProps = {
  searchParams?: {
    status?: string;
  };
};

type PagamentoRow = {
  id: string;
  created_at: string;
  status: string;
  valor_centavos: number | null;
  condominio_id: string | null;
  maquina_id: string | null;
  gateway_pagamento: string | null;
  external_id: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function formatCurrency(value: number | null) {
  if (!value) return "R$ 0,00";
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function PagamentosPage({ searchParams }: PagamentosPageProps) {
  const supabase = supabaseAdmin();
  const statusFilter = searchParams?.status ? String(searchParams.status).trim() : null;

  let query = supabase
    .from("pagamentos")
    .select("id, created_at, status, valor_centavos, condominio_id, maquina_id, gateway_pagamento, external_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (statusFilter) {
    query = query.eq("status", statusFilter.toUpperCase());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao carregar pagamentos: ${error.message}`);

  const rows: PagamentoRow[] = data ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Pagamentos · V1</p>
          <h1 className="text-2xl font-semibold">Últimos 50 registros</h1>
          {statusFilter ? (
            <p className="text-sm text-zinc-600">Filtro aplicado: status = {statusFilter.toUpperCase()}</p>
          ) : (
            <p className="text-sm text-zinc-600">Use ?status=PAGO (ou outro) para filtrar.</p>
          )}
        </header>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">created_at</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">valor</th>
                <th className="px-3 py-2">condominio_id</th>
                <th className="px-3 py-2">maquina_id</th>
                <th className="px-3 py-2">gateway</th>
                <th className="px-3 py-2">external_id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-zinc-500">
                    Nenhum pagamento encontrado.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{row.status}</td>
                    <td className="px-3 py-2">{formatCurrency(row.valor_centavos)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.condominio_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.maquina_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.gateway_pagamento || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.external_id || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
