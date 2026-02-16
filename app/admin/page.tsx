import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function AdminIndexPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  redirect("/admin/dashboard");
}
