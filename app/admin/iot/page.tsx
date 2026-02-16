import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type IoTRow = {
  id: string;
  created_at: string;
  status: string;
  gateway_id: string | null;
  condominio_maquinas_id: string | null;
  pagamento_id: string | null;
  expires_at: string | null;
  ack_at: string | null;
  cmd_id: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

export default async function IoTCommandsPage() {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("iot_commands")
    .select("id, created_at, status, gateway_id, condominio_maquinas_id, pagamento_id, expires_at, ack_at, cmd_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erro ao carregar iot_commands: ${error.message}`);

  const rows: IoTRow[] = data ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">IoT Commands · V1</p>
          <h1 className="text-2xl font-semibold">Últimos 50 registros</h1>
          <p className="text-sm text-zinc-600">Monitoramento direto de `iot_commands`.</p>
        </header>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">created_at</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">gateway_id</th>
                <th className="px-3 py-2">condominio_maquinas_id</th>
                <th className="px-3 py-2">pagamento_id</th>
                <th className="px-3 py-2">expires_at</th>
                <th className="px-3 py-2">ack_at</th>
                <th className="px-3 py-2">cmd_id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-zinc-500">
                    Nenhum comando encontrado.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{row.status}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.gateway_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.condominio_maquinas_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.pagamento_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.expires_at)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.ack_at)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.cmd_id}</td>
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
