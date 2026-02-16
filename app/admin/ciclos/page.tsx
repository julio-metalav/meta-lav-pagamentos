import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type CicloRow = {
  id: string;
  created_at: string;
  status: string;
  condominio_id: string | null;
  maquina_id: string | null;
  pagamento_id: string | null;
  eta_livre_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

export default async function CiclosPage() {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("ciclos")
    .select("id, created_at, status, condominio_id, maquina_id, pagamento_id, eta_livre_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erro ao carregar ciclos: ${error.message}`);

  const rows: CicloRow[] = data ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Ciclos · V1</p>
          <h1 className="text-2xl font-semibold">Últimos 50 ciclos</h1>
          <p className="text-sm text-zinc-600">Consulta direta em `ciclos` (read-only).</p>
        </header>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">created_at</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">condominio_id</th>
                <th className="px-3 py-2">maquina_id</th>
                <th className="px-3 py-2">pagamento_id</th>
                <th className="px-3 py-2">eta_livre_at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-500">
                    Nenhum ciclo encontrado.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{row.status}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.condominio_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.maquina_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.pagamento_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.eta_livre_at)}</td>
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
