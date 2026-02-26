import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

type MachineType = "lavadora" | "secadora";

type Machine = {
  id: string;
  condominio_id: string;
  identificador_local: string;
  tipo: MachineType | string;
  gateway_id: string;
  pos_device_id: string;
  ativa?: boolean;
  updated_at?: string | null;
};

function getBaseUrl(): string {
  const fallback = "http://localhost:3000";
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || fallback;

  try {
    return new URL("/", raw).origin;
  } catch {
    return fallback;
  }
}

async function createMachine(condominioId: string, formData: FormData) {
  "use server";

  const identificador_local = String(formData.get("identificador_local") || "").trim();
  const tipoRaw = String(formData.get("tipo") || "").trim().toLowerCase();
  const gateway_id = String(formData.get("gateway_id") || "").trim();
  const pos_device_id = String(formData.get("pos_device_id") || "").trim();

  if (!identificador_local) throw new Error("identificador_local é obrigatório.");
  if (tipoRaw !== "lavadora" && tipoRaw !== "secadora") {
    throw new Error("tipo inválido. Use lavadora ou secadora.");
  }
  if (!gateway_id) throw new Error("gateway_id é obrigatório.");
  if (!pos_device_id) throw new Error("pos_device_id é obrigatório.");

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/admin/maquinas`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify({
      condominio_id: condominioId,
      identificador_local,
      tipo: tipoRaw as MachineType,
      gateway_id,
      pos_device_id,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Erro HTTP ${res.status} ao criar máquina.`);
  }

  redirect(`/admin/lojas/${condominioId}/maquinas`);
}

export default async function AdminLojaMaquinasPage({ params }: Props) {
  const { id } = await params;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = getBaseUrl();

  let items: Machine[] = [];
  let apiStatus = 0;
  let apiError: string | null = null;

  try {
    const res = await fetch(
      `${baseUrl}/api/admin/maquinas?condominio_id=${encodeURIComponent(id)}`,
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      },
    );

    apiStatus = res.status;

    if (res.status === 401) {
      apiError = "Unauthorized";
    } else if (!res.ok) {
      const txt = await res.text().catch(() => "");
      apiError = txt || `HTTP ${res.status}`;
    } else {
      const json = (await res.json()) as {
        items?: Machine[];
        error?: string;
        error_v1?: { message?: string };
      };
      items = Array.isArray(json?.items) ? json.items : [];
    }
  } catch (e: unknown) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
        Loja {id} — Passo 4 Máquinas
      </h1>
      <p className="mb-6 text-[var(--text-secondary)]">
        Cadastre as máquinas vinculando gateway e POS device.
      </p>

      {apiError && apiStatus === 401 ? (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] mb-6">
          <div className="font-semibold mb-1">Não autenticado</div>
          <div className="text-[var(--text-secondary)]">
            Faça login em{" "}
            <Link
              href="/admin/login"
              className="text-[var(--brand-primary)] hover:underline"
            >
              /admin/login
            </Link>{" "}
            e volte para esta página.
          </div>
        </div>
      ) : apiError ? (
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-[var(--foreground)] mb-6">
          <div className="font-semibold mb-1">Erro ao carregar máquinas</div>
          <div className="text-[var(--text-secondary)] break-all">{apiError}</div>
        </div>
      ) : null}

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
          Máquinas cadastradas
        </h2>

        <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {items.length === 0 ? (
            <li className="p-4 text-[var(--text-secondary)]">
              Nenhuma máquina cadastrada ainda.
            </li>
          ) : (
            items.map((m) => (
              <li key={m.id} className="p-4">
                <div className="font-semibold text-[var(--foreground)]">
                  {m.identificador_local}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  Tipo: {m.tipo} • Gateway: {m.gateway_id} • POS: {m.pos_device_id}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="mb-8 max-w-xl">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">
          Cadastrar nova máquina
        </h2>

        <form action={createMachine.bind(null, id)} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Identificador local</label>
            <input
              name="identificador_local"
              required
              placeholder="Ex.: LAV-01"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Tipo</label>
            <select
              name="tipo"
              defaultValue="lavadora"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
            >
              <option value="lavadora">lavadora</option>
              <option value="secadora">secadora</option>
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">gateway_id</label>
            <input
              name="gateway_id"
              required
              placeholder="UUID do gateway"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">pos_device_id</label>
            <input
              name="pos_device_id"
              required
              placeholder="UUID do POS device"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
          >
            Criar máquina
          </button>
        </form>
      </div>

      <div className="flex gap-4">
        <Link
          href={`/admin/lojas/${id}/gateways`}
          className="text-[var(--brand-primary)] hover:underline"
        >
          ← Voltar
        </Link>
        <Link
          href={`/admin/lojas/${id}/precos`}
          className="text-[var(--brand-primary)] hover:underline"
        >
          Avançar (Passo 5) →
        </Link>
      </div>
    </div>
  );
}
