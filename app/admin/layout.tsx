import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col">
        <header className="mb-6">
          <Link href="/admin" className="text-lg font-semibold text-[var(--foreground)]">
            NEXUS Admin
          </Link>
        </header>
        <nav className="flex flex-col gap-1">
          <Link href="/admin" className="px-3 py-2 rounded-lg hover:bg-[var(--border)]/50 text-[var(--foreground)]">
            Dashboard
          </Link>
          <Link href="/admin/lojas" className="px-3 py-2 rounded-lg hover:bg-[var(--border)]/50 text-[var(--foreground)]">
            Lojas
          </Link>
          <Link href="/admin/operacao" className="px-3 py-2 rounded-lg hover:bg-[var(--border)]/50 text-[var(--foreground)]">
            Operação
          </Link>
          <Link href="/admin/config" className="px-3 py-2 rounded-lg hover:bg-[var(--border)]/50 text-[var(--foreground)]">
            Config
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-6 bg-[var(--background)]">
        {children}
      </main>
    </div>
  );
}
