import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

type Gateway = {
  id: string;
  serial: string;
  condominio_id: string;
  created_at?: string | null;
};

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

async function createGateway(condominioId: string, formData: FormData) {
  "use server";

  const serial = String(formData.get("serial") || "").trim();
  if (!serial) throw new Error("serial é obrigatório.");

  const baseUrl = getBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${baseUrl}/api/admin/gateways`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify({ serial, condominio_id: condominioId }),
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Erro HTTP ${res.status}`);
  }
}

export default async function AdminLojaGatewaysPage({ params }: Props) {
  const { id } = await params;

  const baseUrl = getBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  let items: Gateway[] = [];
  let apiStatus = 0;
  let apiError: string | null = null;

  try {
    const u = new URL(`${baseUrl}/api/admin/gateways`);
    u.searchParams.set("condominio_id", id);

    const res = await fetch(u.toString(), {
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
      const json = (await res.json()) as { items?: Gateway[] };
      items = (json?.items || []) as Gateway[];
    }
  } catch (e: unknown) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
        Loja {id} — Passo 3 Gateway
      </h1>
      <p className="mb-6 text-[var(--text-secondary)]">
        Cadastre o gateway vinculado a esta loja.
      </p>

      {apiError && apiStatus === 401 ? (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] mb-6">
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
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-[var(--foreground)] mb-6">
          <div className="font-semibold mb-1">Erro ao carregar gateways</div>
          <div className="text-[var(--text-secondary)] break-all">{apiError}</div>
        </div>
      ) : null}

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
          Gateways cadastrados
        </h2>
        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {items.length === 0 ? (
            <li className="p-4 text-[var(--text-secondary)]">
              Nenhum gateway cadastrado ainda.
            </li>
          ) : (
            items.map((g) => (
              <li key={g.id} className="p-4">
                <div className="font-semibold text-[var(--foreground)]">{g.serial}</div>
                <div className="text-sm text-[var(--text-secondary)]">
                  created_at: {g.created_at || "—"}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="mb-8 max-w-xl">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
          Cadastrar novo gateway
        </h2>
        <form action={createGateway.bind(null, id)} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Serial do gateway</label>
            <input
              name="serial"
              required
              placeholder="Ex.: GW-LAB-01"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
          >
            Salvar gateway
          </button>
        </form>
      </div>

      <div className="flex gap-4">
        <Link href={`/admin/lojas/${id}/pos`} className="text-[var(--brand-primary)] hover:underline">
          ← Voltar
        </Link>
        <Link href={`/admin/lojas/${id}/kit`} className="text-[var(--brand-primary)] hover:underline">
          Kit (reconciliar / transferir) →
        </Link>
      </div>
    </div>
  );
}
