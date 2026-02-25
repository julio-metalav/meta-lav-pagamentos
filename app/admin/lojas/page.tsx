import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLojasPage() {
  const fakeId = "00000000-0000-0000-0000-000000000000";
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-4">
        Lojas
      </h1>
      <p className="mb-4 text-[var(--text-secondary)]">
        Lista de lojas (em construção — sem fetch).
      </p>
      <Link
        href="/admin/lojas/nova"
        className="inline-block px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-white hover:opacity-90 mb-6"
      >
        Nova Loja
      </Link>
      <ul className="list-disc list-inside text-[var(--foreground)]">
        <li>
          <Link
            href={`/admin/lojas/${fakeId}`}
            className="text-[var(--brand-primary)] hover:underline"
          >
            Loja exemplo ({fakeId})
          </Link>
        </li>
      </ul>
    </div>
  );
}
