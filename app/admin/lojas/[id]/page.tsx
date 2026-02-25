import Link from "next/link";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminLojaDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-4">
        Loja {id}
      </h1>
      <div className="mb-6">
        <h2 className="text-lg font-medium text-[var(--foreground)] mb-3">
          Progresso do Wizard
        </h2>
        <ul className="list-none space-y-2">
          <li>
            <Link
              href={`/admin/lojas/${id}/pos`}
              className="text-[var(--brand-primary)] hover:underline"
            >
              Passo 2 POS
            </Link>
          </li>
          <li>
            <Link
              href={`/admin/lojas/${id}/gateways`}
              className="text-[var(--brand-primary)] hover:underline"
            >
              Passo 3 Gateway
            </Link>
          </li>
          <li>
            <Link
              href={`/admin/lojas/${id}/maquinas`}
              className="text-[var(--brand-primary)] hover:underline"
            >
              Passo 4 Máquinas
            </Link>
          </li>
          <li>
            <Link
              href={`/admin/lojas/${id}/precos`}
              className="text-[var(--brand-primary)] hover:underline"
            >
              Passo 5 Preços
            </Link>
          </li>
          <li>
            <Link
              href={`/admin/lojas/${id}/revisao`}
              className="text-[var(--brand-primary)] hover:underline"
            >
              Passo 6 Revisão/Testes
            </Link>
          </li>
        </ul>
      </div>
      <Link
        href="/admin/lojas"
        className="text-[var(--brand-primary)] hover:underline"
      >
        ← Voltar para Lojas
      </Link>
    </div>
  );
}
