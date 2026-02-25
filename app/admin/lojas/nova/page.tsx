import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLojasNovaPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-4">
        Nova Loja — Passo 1
      </h1>
      <p className="mb-4 text-[var(--text-secondary)]">
        Aqui será o formulário de criação (nome, cidade, UF, ativo, código)
      </p>
      <p className="mb-4 text-[var(--text-muted)]">Em construção.</p>
      <Link
        href="/admin/lojas"
        className="text-[var(--brand-primary)] hover:underline"
      >
        ← Voltar para Lojas
      </Link>
    </div>
  );
}
