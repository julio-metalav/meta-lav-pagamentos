import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type GatewayRow = {
  id: string;
  condominio_id: string | null;
  serial: string | null;
  created_at: string;
  last_seen_at: string | null;
  busy: boolean | null;
  rssi: number | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value ? "sim" : "não";
}

export default async function GatewaysPage() {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("gateways")
    .select("id, condominio_id, serial, created_at, last_seen_at, busy, rssi")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erro ao carregar gateways: ${error.message}`);

  const rows: GatewayRow[] = data ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Gateways · V1</p>
          <h1 className="text-2xl font-semibold">Últimos 50 gateways</h1>
          <p className="text-sm text-zinc-600">Somente leitura, direto do Supabase.</p>
        </header>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">created_at</th>
                <th className="px-3 py-2">serial</th>
                <th className="px-3 py-2">condominio_id</th>
                <th className="px-3 py-2">last_seen_at</th>
                <th className="px-3 py-2">busy</th>
                <th className="px-3 py-2">rssi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-zinc-500">
                    Nenhum gateway encontrado.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.id}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.serial || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.condominio_id || "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatDate(row.last_seen_at)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{formatBoolean(row.busy)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.rssi ?? "—"}</td>
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
