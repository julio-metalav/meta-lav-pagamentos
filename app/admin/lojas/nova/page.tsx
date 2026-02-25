import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function createLoja(formData: FormData) {
  "use server";

  const nome = String(formData.get("nome") || "").trim();
  const cidade = String(formData.get("cidade") || "").trim();
  const uf = String(formData.get("uf") || "").trim().toUpperCase();
  const ativo = formData.get("ativo") === "on";
  const codigo_condominio = String(
    formData.get("codigo_condominio") || ""
  ).trim();

  if (!nome || !cidade || !uf || uf.length !== 2) {
    throw new Error("Dados inválidos. Verifique nome, cidade e UF.");
  }

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch("/api/admin/condominios", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify({
      nome,
      cidade,
      uf,
      ativo,
      codigo_condominio: codigo_condominio || undefined,
    }),
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (contentType.includes("text/html")) {
      throw new Error("Upstream returned HTML; baseUrl likely wrong. " + (txt ? txt.slice(0, 200) : `HTTP ${res.status}`));
    }
    throw new Error((txt && txt.length > 0 ? txt.slice(0, 200) : `Erro HTTP ${res.status}`));
  }

  const json = await res.json();
  const id = json?.item?.id;

  if (!id) {
    throw new Error("ID da loja não retornado.");
  }

  redirect(`/admin/lojas/${id}`);
}

export default function AdminLojasNovaPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-6">
        Nova Loja — Passo 1
      </h1>

      <form action={createLoja} className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm mb-1">Nome</label>
          <input
            name="nome"
            required
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Cidade</label>
          <input
            name="cidade"
            required
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">UF</label>
          <input
            name="uf"
            maxLength={2}
            required
            className="w-20 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent uppercase"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Código interno (opcional)</label>
          <input
            name="codigo_condominio"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="ativo" defaultChecked />
          <label>Loja ativa</label>
        </div>

        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90"
          >
            Criar Loja
          </button>

          <Link
            href="/admin/lojas"
            className="text-[var(--brand-primary)] hover:underline"
          >
            ← Voltar
          </Link>
        </div>
      </form>
    </div>
  );
}
