import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

type PosDevice = { id: string; serial: string; condominio_id: string };
type Gateway = { id: string; serial: string; condominio_id: string };
type Condominio = { id: string; nome: string };

function getBaseUrl() {
  const env =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.VERCEL_URL ||
    "";
  if (!env) return "http://localhost:3000";
  if (env.startsWith("http")) return env;
  return `https://${env}`;
}

async function reconcileKit(condominioId: string, formData: FormData) {
  "use server";
  const pos_device_id = String(formData.get("pos_device_id") || "").trim();
  const gateway_id = String(formData.get("gateway_id") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || undefined;
  if (!pos_device_id || !gateway_id) throw new Error("Selecione POS e Gateway.");

  const baseUrl = getBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${baseUrl}/api/admin/kits/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ condominio_id: condominioId, pos_device_id, gateway_id, reason }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error === "string" ? data.error : data?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  redirect(`/admin/lojas/${condominioId}/kit?reconciled=1`);
}

async function transferKit(condominioId: string, formData: FormData) {
  "use server";
  const pos_device_id = String(formData.get("pos_device_id") || "").trim();
  const gateway_id = String(formData.get("gateway_id") || "").trim();
  const to_condominio_id = String(formData.get("to_condominio_id") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || undefined;
  if (!pos_device_id || !gateway_id) throw new Error("Selecione POS e Gateway.");
  if (!to_condominio_id) throw new Error("Selecione a loja de destino.");

  const baseUrl = getBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${baseUrl}/api/admin/kits/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({
      pos_device_id,
      gateway_id,
      to_condominio_id,
      reason,
      auto_reconcile_expired: true,
    }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error === "string" ? data.error : data?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  redirect(`/admin/lojas/${to_condominio_id}/kit?transferred=1`);
}

export default async function AdminLojaKitPage({ params }: Props) {
  const { id } = await params;

  const baseUrl = getBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  let posList: PosDevice[] = [];
  let gatewayList: Gateway[] = [];
  let condominioList: Condominio[] = [];
  let apiError: string | null = null;
  let apiStatus = 0;

  try {
    const [posRes, gwRes, condRes] = await Promise.all([
      fetch(`${baseUrl}/api/admin/pos-devices?condominio_id=${id}`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
      fetch(`${baseUrl}/api/admin/gateways?condominio_id=${id}&limit=100`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
      fetch(`${baseUrl}/api/admin/condominios?limit=200`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    ]);

    apiStatus = posRes.status;
    if (posRes.status === 401 || gwRes.status === 401 || condRes.status === 401) {
      apiError = "Unauthorized";
    } else if (!posRes.ok || !gwRes.ok || !condRes.ok) {
      apiError = "Erro ao carregar dados.";
    } else {
      const posJson = (await posRes.json()) as { items?: PosDevice[] };
      const gwJson = (await gwRes.json()) as { items?: Gateway[] };
      const condJson = (await condRes.json()) as { items?: Condominio[] };
      posList = posJson?.items ?? [];
      gatewayList = gwJson?.items ?? [];
      condominioList = (condJson?.items ?? []).filter((c) => c.id !== id);
    }
  } catch (e: unknown) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
        Loja {id} — Kit (POS + Gateway)
      </h1>
      <p className="mb-6 text-[var(--text-secondary)]">
        Reconciliar pendências (TTL vencido) ou transferir o kit para outra loja.
      </p>

      {apiError && apiStatus === 401 ? (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] mb-6">
          <div className="font-semibold mb-1">Não autenticado</div>
          <div className="text-[var(--text-secondary)]">
            Faça login em{" "}
            <Link href="/admin/login" className="text-[var(--brand-primary)] hover:underline">
              /admin/login
            </Link>{" "}
            e volte para esta página.
          </div>
        </div>
      ) : apiError ? (
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 mb-6">
          <div className="font-semibold mb-1">Erro</div>
          <div className="text-[var(--text-secondary)] break-all">{apiError}</div>
        </div>
      ) : (
        <>
          <div className="mb-8 max-w-xl space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
                Reconciliar pendências do Kit
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                Marca comandos/ciclos vencidos por TTL como EXPIRADO/ABORTADO. Não mexe em ciclos EM_USO.
              </p>
              <form action={reconcileKit.bind(null, id)} className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">POS</label>
                  <select
                    name="pos_device_id"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  >
                    <option value="">— Selecione —</option>
                    {posList.map((p) => (
                      <option key={p.id} value={p.id}>{p.serial}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Gateway</label>
                  <select
                    name="gateway_id"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  >
                    <option value="">— Selecione —</option>
                    {gatewayList.map((g) => (
                      <option key={g.id} value={g.id}>{g.serial}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Motivo (opcional)</label>
                  <input name="reason" className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent" />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
                >
                  Reconciliar pendências
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
                Transferir Kit para outra Loja
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                Move POS e Gateway juntos. Desanexe máquinas antes. Pendências vencidas são reconciliadas automaticamente.
              </p>
              <form action={transferKit.bind(null, id)} className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">POS</label>
                  <select
                    name="pos_device_id"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  >
                    <option value="">— Selecione —</option>
                    {posList.map((p) => (
                      <option key={p.id} value={p.id}>{p.serial}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Gateway</label>
                  <select
                    name="gateway_id"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  >
                    <option value="">— Selecione —</option>
                    {gatewayList.map((g) => (
                      <option key={g.id} value={g.id}>{g.serial}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Loja de destino</label>
                  <select
                    name="to_condominio_id"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  >
                    <option value="">— Selecione —</option>
                    {condominioList.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Motivo (opcional)</label>
                  <input name="reason" className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent" />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
                >
                  Transferir Kit
                </button>
              </form>
            </section>
          </div>
        </>
      )}

      <div className="flex gap-4">
        <Link href={`/admin/lojas/${id}/gateways`} className="text-[var(--brand-primary)] hover:underline">
          ← Voltar (Gateways)
        </Link>
        <Link href={`/admin/lojas/${id}/maquinas`} className="text-[var(--brand-primary)] hover:underline">
          Avançar (Máquinas) →
        </Link>
      </div>
    </div>
  );
}
