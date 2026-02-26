import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySession } from "@/lib/admin/auth";

export type AdminSession = { user_id: string; exp: number };

const COOKIE_NAME = "admin_session";

export async function getAdminSession(): Promise<AdminSession | null> {
  const secret = String(process.env.ADMIN_SESSION_SECRET || "");
  if (!secret) return null;

  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value || jar.get("admin_sm")?.value || "";
  if (!token) return null;
  const v = verifySession(token, secret);
  if (!v.ok) return null;
  const uid = String((v as any).payload?.user_id || "");
  const exp = Number((v as any).payload?.exp || 0);
  if (!uid || !Number.isFinite(exp)) return null;
  if (Date.now() > exp) return null;
  return { user_id: uid, exp };
}

export async function requireAdminSession() {
  const sess = await getAdminSession();
  if (!sess) return { ok: false as const, session: null };

  const sb = supabaseAdmin() as any;
  const { data: user } = await sb
    .from("admin_users")
    .select("id,email,enabled,status")
    .eq("id", sess.user_id)
    .maybeSingle();

  if (!user || !user.enabled || String(user.status) !== "active") return { ok: false as const, session: null };
  return { ok: true as const, session: sess, user };
}

export async function getAdminPermissions(userId: string): Promise<Set<string>> {
  const sb = supabaseAdmin() as any;

  // role perms
  const { data: rolePerms } = await sb
    .from("admin_user_roles")
    .select("admin_roles(code), admin_roles:admin_roles(id), admin_roles!inner(id), admin_roles!inner(code), admin_role_permissions(permission_id), admin_role_permissions:admin_role_permissions(permission_id), admin_role_permissions!inner(permission_id), admin_permissions(code)")
    .eq("user_id", userId);

  // The above select is messy across Supabase; use two queries for reliability.
  const { data: roles } = await sb
    .from("admin_user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roles || []).map((r: any) => r.role_id).filter(Boolean);

  const permSet = new Set<string>();

  if (roleIds.length) {
    const { data: rp } = await sb
      .from("admin_role_permissions")
      .select("permission_id")
      .in("role_id", roleIds);

    const permIds = (rp || []).map((x: any) => x.permission_id).filter(Boolean);

    if (permIds.length) {
      const { data: perms } = await sb
        .from("admin_permissions")
        .select("id,code")
        .in("id", permIds);
      for (const p of perms || []) permSet.add(String(p.code));
    }
  }

  // user overrides
  const { data: up } = await sb
    .from("admin_user_permissions")
    .select("allowed, admin_permissions(code)")
    .eq("user_id", userId);

  for (const row of up || []) {
    const code = String((row as any).admin_permissions?.code || "");
    if (!code) continue;
    const allowed = Boolean((row as any).allowed);
    if (allowed) permSet.add(code);
    else permSet.delete(code);
  }

  return permSet;
}

export async function requirePermission(userId: string, perm: string) {
  const perms = await getAdminPermissions(userId);
  return perms.has(perm);
}
