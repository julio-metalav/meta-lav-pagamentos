/**
 * Resolução de tenant para multi-tenant (NEXUS).
 * Por enquanto: um único tenant (Meta-Lav) via DEFAULT_TENANT_ID.
 * Futuro: getTenantIdFromRequest pode ler header x-tenant ou JWT.
 */

const META_LAV_TENANT_ID = "b5bec38d-dfec-4f33-821d-4f1c7f44db32";

/**
 * Retorna o tenant_id padrão (env DEFAULT_TENANT_ID ou Meta-Lav).
 */
export function getDefaultTenantId(): string {
  const v = process.env.DEFAULT_TENANT_ID;
  if (v && typeof v === "string" && v.trim()) return v.trim();
  return META_LAV_TENANT_ID;
}

/**
 * Retorna o tenant_id para a requisição atual.
 * Por enquanto sempre retorna o default; no futuro pode ler header x-tenant ou JWT.
 */
export function getTenantIdFromRequest(req: Request | null): string {
  if (req) {
    const header = req.headers.get("x-tenant")?.trim();
    if (header) {
      // Futuro: validar contra lista de tenants permitidos
      return header;
    }
  }
  return getDefaultTenantId();
}
