/**
 * Resolução soberana de preço no backend.
 * POS e Gateway são burros; o backend é a fonte única.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ServiceType = "lavadora" | "secadora";

export type ResolvePriceParams = {
  tenantId: string;
  condominioId: string;
  condominioMaquinasId: string;
  serviceType: ServiceType;
  supabaseClient: SupabaseClient;
};

export type MachineRow = {
  id: string;
  condominio_id: string;
  tipo: string;
  ativa: boolean | null;
};

/** Row de precos_ciclo (colunas conhecidas + índice para extensão) */
export type PrecoRow = {
  id?: string | null;
  maquina_id?: string | null;
  valor_centavos?: number | null;
  preco_centavos?: number | null;
  amount_centavos?: number | null;
  valor?: number | null;
  preco?: number | null;
  amount?: number | null;
  tipo?: string | null;
  tipo_maquina?: string | null;
  service_type?: string | null;
  categoria?: string | null;
  vigente_desde?: string | null;
  vigente_ate?: string | null;
  created_at?: string | null;
};

export type ResolvedPrice = {
  amountCentavos: number;
  ruleId: string | null;
};

export class PriceResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: "machine_not_found" | "price_not_found" | "invalid_price" | "db_error",
    public readonly details?: string
  ) {
    super(message);
    this.name = "PriceResolutionError";
    Object.setPrototypeOf(this, PriceResolutionError.prototype);
  }
}

function pickAmountCents(row: PrecoRow): number | null {
  const centsCandidates: (keyof PrecoRow)[] = ["valor_centavos", "preco_centavos", "amount_centavos"];
  for (const k of centsCandidates) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  }
  const brlCandidates: (keyof PrecoRow)[] = ["valor", "preco", "amount"];
  for (const k of brlCandidates) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v * 100);
  }
  return null;
}

function rowMatchesService(row: PrecoRow, serviceType: ServiceType): boolean {
  const candidates = [row.tipo, row.tipo_maquina, row.service_type, row.categoria];
  const normalized = candidates
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return true;
  return normalized.includes(serviceType);
}

/**
 * Resolve o preço vigente para a máquina e tipo de serviço.
 * Valida tenant, máquina ativa e vigência.
 * @throws PriceResolutionError se máquina não encontrada, preço não encontrado ou erro de banco
 */
export async function resolvePriceOrThrow(params: ResolvePriceParams): Promise<ResolvedPrice> {
  const { tenantId, condominioId, condominioMaquinasId, serviceType, supabaseClient } = params;
  const sb = supabaseClient;

  const { data: machine, error: mErr } = await sb
    .from("condominio_maquinas")
    .select("id, condominio_id, tipo, ativa")
    .eq("tenant_id", tenantId)
    .eq("id", condominioMaquinasId)
    .eq("condominio_id", condominioId)
    .maybeSingle();

  if (mErr) {
    throw new PriceResolutionError("Erro ao consultar máquina.", "db_error", mErr.message);
  }
  if (!machine || !machine.ativa) {
    throw new PriceResolutionError("machine not found", "machine_not_found");
  }

  const machineRow = machine as MachineRow;
  const nowIso = new Date().toISOString();

  const { data: rows, error: pErr } = await sb
    .from("precos_ciclo")
    .select("*")
    .eq("maquina_id", machineRow.id)
    .or(`vigente_ate.is.null,vigente_ate.gte.${nowIso}`)
    .lte("vigente_desde", nowIso)
    .limit(100);

  if (pErr) {
    throw new PriceResolutionError("Erro ao consultar precos_ciclo.", "db_error", pErr.message);
  }

  const list = (rows ?? []) as PrecoRow[];
  const filtered = list.filter((r) => rowMatchesService(r, serviceType));
  const chosen = filtered.find((r) => pickAmountCents(r) !== null) ?? list.find((r) => pickAmountCents(r) !== null);

  if (!chosen) {
    throw new PriceResolutionError("price not found", "price_not_found");
  }

  const amountCentavos = pickAmountCents(chosen);
  if (!amountCentavos) {
    throw new PriceResolutionError("invalid price", "invalid_price");
  }

  return {
    amountCentavos,
    ruleId: chosen.id ? String(chosen.id) : null,
  };
}
