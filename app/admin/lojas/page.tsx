import Link from "next/link";
import { cookies } from "next/headers";
import { getServerBaseUrl } from "@/lib/http/getServerBaseUrl";

export const dynamic = "force-dynamic";

type Loja = {
  id: string;
  nome: string;
  cidade?: string | null;
  uf?: string | null;
  ativo?: boolean | null;
  codigo_condominio?: string | null;
  updated_at?: string | null;
};

export default async function AdminLojasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const page = Math.max(
    1,
    Number(
      (typeof searchParams?.page === "string" && searchParams.page) || "1"
    )
  );
  const limit = Math.min(
    50,
    Math.max(
      5,
      Number(
        (typeof searchParams?.limit === "string" && searchParams.limit) || "20"
      )
    )
  );
  const search =
    (typeof searchParams?.search === "string" && searchParams.search.trim()) ||
    "";

  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("limit", String(limit));
  if (search) qs.set("search", search);

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = await getServerBaseUrl();

  let items: Loja[] = [];
  let total = 0;
  let totalPages = 1;
  let apiStatus = 0;
  let apiError: string | null = null;

  try {
    const res = await fetch(`${baseUrl}/api/admin/condominios?${qs.toString()}`, {
      headers: {
        cookie: cookieHeader,
      },
      cache: "no-store",
    });

    apiStatus = res.status;

    if (res.status === 401) {
      apiError = "Unauthorized";
    } else if (!res.ok) {
      const txt = await res.text().catch(() => "");
      apiError = txt || `HTTP ${res.status}`;
    } else {
      const json = (await res.json()) as { items?: Loja[]; total?: number; total_pages?: number };
      items = (json?.items || []) as Loja[];
      total = Number(json?.total || 0);
      totalPages = Number(json?.total_pages || 1);
    }
  } catch (e: unknown) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  const prevHref =
    page > 1
      ? `/admin/lojas?page=${page - 1}&limit=${limit}${
          search ? `&search=${encodeURIComponent(search)}` : ""
        }`
      : null;

  const nextHref =
    page < totalPages
      ? `/admin/lojas?page=${page + 1}&limit=${limit}${
          search ? `&search=${encodeURIComponent(search)}` : ""
        }`
      : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          Lojas
        </h1>
        <Link
          href="/admin/lojas/nova"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
        >
          Nova Loja
        </Link>
      </div>

      <form className="flex items-center gap-2 mb-4" action="/admin/lojas" method="get">
        <input
          name="search"
          defaultValue={search}
          placeholder="Buscar por nome..."
          className="px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-[var(--foreground)] w-full max-w-sm"
        />
        <input type="hidden" name="limit" value={String(limit)} />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--text-muted)]/20"
        >
          Buscar
        </button>
      </form>

      {apiError && apiStatus === 401 ? (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]">
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
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-[var(--foreground)]">
          <div className="font-semibold mb-1">Erro ao carregar lojas</div>
          <div className="text-[var(--text-secondary)] break-all">
            {apiError}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 text-[var(--text-secondary)]">
            Total: <span className="text-[var(--foreground)]">{total}</span>
          </div>

          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
            {items.length === 0 ? (
              <li className="p-4 text-[var(--text-secondary)]">
                Nenhuma loja encontrada.
              </li>
            ) : (
              items.map((l) => (
                <li key={l.id} className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-[var(--foreground)]">
                      <Link
                        href={`/admin/lojas/${l.id}`}
                        className="text-[var(--brand-primary)] hover:underline"
                      >
                        {l.nome}
                      </Link>
                    </div>
                    <div className="text-sm text-[var(--text-secondary)]">
                      {(l.cidade || "—")}, {(l.uf || "—")} •{" "}
                      {l.ativo ? "Ativa" : "Inativa"}
                      {l.codigo_condominio ? ` • Código: ${l.codigo_condominio}` : ""}
                    </div>
                  </div>
                  <Link
                    href={`/admin/lojas/${l.id}`}
                    className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--text-muted)]/20"
                  >
                    Abrir
                  </Link>
                </li>
              ))
            )}
          </ul>

          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-[var(--text-secondary)]">
              Página {page} de {totalPages}
            </div>
            <div className="flex gap-2">
              <Link
                aria-disabled={!prevHref}
                href={prevHref || "#"}
                className={`px-3 py-2 rounded-lg border border-[var(--border)] ${
                  prevHref ? "hover:bg-[var(--text-muted)]/20" : "opacity-50 pointer-events-none"
                }`}
              >
                Anterior
              </Link>
              <Link
                aria-disabled={!nextHref}
                href={nextHref || "#"}
                className={`px-3 py-2 rounded-lg border border-[var(--border)] ${
                  nextHref ? "hover:bg-[var(--text-muted)]/20" : "opacity-50 pointer-events-none"
                }`}
              >
                Próxima
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
