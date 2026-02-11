import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function AdminEntryPage() {
  const session = await getAdminSession();
  if (session) {
    redirect("/admin/users");
  }
  redirect("/admin/login");
}
