import Link from "next/link";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminLojaPrecosPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-4">
        Loja {id} — Passo 5 Preços
      </h1>
      <p className="mb-6 text-[var(--text-secondary)]">Em construção.</p>
      <div className="flex gap-4">
        <Link
          href={`/admin/lojas/${id}/maquinas`}
          className="text-[var(--brand-primary)] hover:underline"
        >
          ← Voltar
        </Link>
        <Link
          href={`/admin/lojas/${id}/revisao`}
          className="text-[var(--brand-primary)] hover:underline"
        >
          Avançar (Passo 6) →
        </Link>
      </div>
    </div>
  );
}
