import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-6">
        Dashboard Operacional
      </h1>
      <nav className="flex flex-col gap-3">
        <Link
          href="/admin/lojas"
          className="text-[var(--brand-primary)] hover:underline"
        >
          Lojas
        </Link>
        <Link
          href="/admin/operacao"
          className="text-[var(--brand-primary)] hover:underline"
        >
          Operação
        </Link>
        <Link
          href="/admin/config"
          className="text-[var(--brand-primary)] hover:underline"
        >
          Config
        </Link>
      </nav>
    </div>
  );
}
