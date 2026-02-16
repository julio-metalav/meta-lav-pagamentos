import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function startOfTomorrowIso() {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}

function formatCurrencyFromCents(cents: number) {
  const value = cents / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCondominio(id: string | null | undefined) {
  return id ? id : "(sem condominio)";
}

type TopEntry = { condominio_id: string; total: number };

type DashboardData = {
  machinesActive: number;
  machinesInactive: number;
  cyclesToday: number;
  receitaHojeCentavos: number;
  commandsPending: number;
  commandsExpired: number;
  topCycles: TopEntry[];
  topReceita: TopEntry[];
};

async function getDashboardData(): Promise<DashboardData> {
  const supabase = supabaseAdmin();
  const todayIso = startOfTodayIso();
  const tomorrowIso = startOfTomorrowIso();

  const [activeMachinesRes, inactiveMachinesRes, pendingCommandsRes, expiredCommandsRes, ciclosHojeRes, pagamentosHojeRes] = await Promise.all([
    supabase.from("condominio_maquinas").select("id", { count: "exact", head: true }).eq("ativa", true),
    supabase.from("condominio_maquinas").select("id", { count: "exact", head: true }).eq("ativa", false),
    supabase.from("iot_commands").select("id", { count: "exact", head: true }).eq("status", "PENDENTE"),
    supabase.from("iot_commands").select("id", { count: "exact", head: true }).eq("status", "EXPIRADO"),
    supabase
      .from("ciclos")
      .select("id, condominio_id, created_at")
      .gte("created_at", todayIso)
      .lt("created_at", tomorrowIso)
      .limit(1000),
    supabase
      .from("pagamentos")
      .select("id, condominio_id, valor_centavos, paid_at")
      .eq("status", "PAGO")
      .gte("paid_at", todayIso)
      .lt("paid_at", tomorrowIso)
      .limit(1000),
  ]);

  if (activeMachinesRes.error) throw new Error(`Erro ao contar máquinas ativas: ${activeMachinesRes.error.message}`);
  if (inactiveMachinesRes.error) throw new Error(`Erro ao contar máquinas inativas: ${inactiveMachinesRes.error.message}`);
  if (pendingCommandsRes.error) throw new Error(`Erro ao contar comandos pendentes: ${pendingCommandsRes.error.message}`);
  if (expiredCommandsRes.error) throw new Error(`Erro ao contar comandos expirados: ${expiredCommandsRes.error.message}`);
  if (ciclosHojeRes.error) throw new Error(`Erro ao listar ciclos do dia: ${ciclosHojeRes.error.message}`);
  if (pagamentosHojeRes.error) throw new Error(`Erro ao listar pagamentos do dia: ${pagamentosHojeRes.error.message}`);

  const ciclosHoje = ciclosHojeRes.data ?? [];
  const pagamentosHoje = pagamentosHojeRes.data ?? [];

  const receitaHojeCentavos = pagamentosHoje.reduce((acc, cur) => acc + Number(cur?.valor_centavos ?? 0), 0);

  const ciclosByCondo = new Map<string, number>();
  for (const ciclo of ciclosHoje) {
    const key = ciclo?.condominio_id || "(sem condominio)";
    ciclosByCondo.set(key, (ciclosByCondo.get(key) ?? 0) + 1);
  }

  const receitaByCondo = new Map<string, number>();
  for (const pay of pagamentosHoje) {
    const key = pay?.condominio_id || "(sem condominio)";
    const val = Number(pay?.valor_centavos ?? 0);
    receitaByCondo.set(key, (receitaByCondo.get(key) ?? 0) + val);
  }

  const topCycles = Array.from(ciclosByCondo.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([condominio_id, total]) => ({ condominio_id, total }));

  const topReceita = Array.from(receitaByCondo.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([condominio_id, total]) => ({ condominio_id, total }));

  return {
    machinesActive: activeMachinesRes.count ?? 0,
    machinesInactive: inactiveMachinesRes.count ?? 0,
    cyclesToday: ciclosHoje.length,
    receitaHojeCentavos,
    commandsPending: pendingCommandsRes.count ?? 0,
    commandsExpired: expiredCommandsRes.count ?? 0,
    topCycles,
    topReceita,
  };
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="text-3xl font-semibold text-zinc-900">{value}</p>
      {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function TopTable({ title, items, formatValue }: { title: string; items: TopEntry[]; formatValue: (value: number) => string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      </header>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2">Condomínio</th>
            <th className="px-4 py-2 text-right">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.length === 0 ? (
            <tr>
              <td className="px-4 py-3 text-sm text-zinc-500" colSpan={2}>
                Nenhum dado hoje.
              </td>
            </tr>
          ) : (
            items.map((item, idx) => (
              <tr key={`${item.condominio_id}-${idx}`}>
                <td className="px-4 py-2 text-zinc-700">{formatCondominio(item.condominio_id)}</td>
                <td className="px-4 py-2 text-right font-medium">{formatValue(item.total)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="min-h-screen bg-slate-50 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Dashboard · V1</p>
          <h1 className="text-2xl font-semibold">Visão Geral</h1>
          <p className="text-sm text-zinc-600">Dados em tempo quase real direto do Supabase (read-only).</p>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard title="Máquinas ativas" value={String(data.machinesActive)} subtitle="condominio_maquinas.ativa = true" />
          <StatCard title="Máquinas inativas" value={String(data.machinesInactive)} subtitle="condominio_maquinas.ativa = false" />
          <StatCard title="Ciclos hoje" value={String(data.cyclesToday)} subtitle="ciclos criados desde 00:00" />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard title="Receita hoje" value={formatCurrencyFromCents(data.receitaHojeCentavos)} subtitle="pagamentos PAGO no dia" />
          <StatCard title="Comandos pendentes" value={String(data.commandsPending)} subtitle="iot_commands.status = PENDENTE" />
          <StatCard title="Comandos expirados" value={String(data.commandsExpired)} subtitle="iot_commands.status = EXPIRADO" />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TopTable title="Top 5 condomínios · Ciclos hoje" items={data.topCycles} formatValue={(value) => `${value} ciclos`} />
          <TopTable title="Top 5 condomínios · Receita hoje" items={data.topReceita} formatValue={(value) => formatCurrencyFromCents(value)} />
        </section>
      </div>
    </div>
  );
}
