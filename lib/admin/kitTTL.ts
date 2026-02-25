/**
 * TTL para Kit (POS+Gateway): comandos e ciclos.
 * Pendência REAL = dentro do TTL (bloqueia transfer/reconcile).
 * Pendência VENCIDA = fora do TTL => reconcile terminaliza (EXPIRADO/ABORTADO).
 * Fonte: docs/db-schema.yml, docs/FONTE_DA_VERDADE_NEXUS_DB.md, lib/iot/service.ts
 */

/** Status de ciclo considerados "pré-uso" (podem expirar por TTL). DB: ciclo_status enum. */
export const CICLO_STATUS_PRE_USO = [
  "AGUARDANDO_LIBERACAO",
  "LIBERADO",
] as const;

/** Status de ciclo EM_USO — não terminalizar sem evidência BUSY_OFF. */
export const CICLO_STATUS_EM_USO = "EM_USO" as const;

/** Status terminais de comando IoT (não bloqueiam). */
export const CMD_STATUS_TERMINAL = ["EXPIRADO", "EXECUTADO", "ACK", "FALHOU"] as const;

/** Status de comando não-terminal (bloqueiam se dentro do TTL). */
export const CMD_STATUS_NON_TERMINAL = ["PENDENTE", "pendente", "pending", "ENVIADO"] as const;

/** TTL fallback para comando (segundos) quando não há expires_at ou colunas delivery_timeout_*. */
const CMD_TTL_FALLBACK_SEC = 10 * 60; // 10 min

/** TTL para ciclos pré-uso (segundos). Env: KIT_CYCLE_PRE_TTL_SEC. */
const CYCLE_PRE_TTL_SEC = Number(process.env.KIT_CYCLE_PRE_TTL_SEC || 15 * 60); // 15 min

/** TTL conservador para EM_USO sem evidência de término (segundos). */
const CYCLE_EM_USO_TTL_SEC = 3 * 60 * 60; // 3h

export type CommandRow = {
  id?: string;
  created_at?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
  status?: string | null;
  payload?: Record<string, unknown> | null;
  delivery_timeout_ack_sec?: number | null;
  delivery_timeout_busy_sec?: number | null;
};

export type CycleRow = {
  id?: string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  busy_on_at?: string | null;
  busy_off_at?: string | null;
};

/**
 * Calcula TTL em segundos para um comando.
 * Preferência: delivery_timeout_ack_sec + delivery_timeout_busy_sec + 60; senão expires_at; senão fallback 10 min.
 */
export function computeCommandTTLSeconds(cmdRow: CommandRow): number {
  const ack = cmdRow.delivery_timeout_ack_sec;
  const busy = cmdRow.delivery_timeout_busy_sec;
  if (typeof ack === "number" && ack >= 0 && typeof busy === "number" && busy >= 0) {
    return ack + busy + 60;
  }
  if (cmdRow.expires_at) {
    const expMs = new Date(cmdRow.expires_at).getTime();
    const createdMs = cmdRow.created_at ? new Date(cmdRow.created_at).getTime() : Date.now();
    if (Number.isFinite(expMs) && Number.isFinite(createdMs) && expMs > createdMs) {
      return Math.ceil((expMs - createdMs) / 1000);
    }
  }
  return CMD_TTL_FALLBACK_SEC;
}

/**
 * TTL para ciclo pré-uso (AGUARDANDO_LIBERACAO, LIBERADO): 15 min (configurável por KIT_CYCLE_PRE_TTL_SEC).
 * Para EM_USO: não expirar automaticamente sem BUSY_OFF; fallback 3h se precisar de limite.
 */
export function computeCycleTTLSeconds(cycleRow: CycleRow): number {
  const status = String(cycleRow.status ?? "").toUpperCase();
  if (status === CICLO_STATUS_EM_USO) {
    return CYCLE_EM_USO_TTL_SEC;
  }
  if (CICLO_STATUS_PRE_USO.includes(status as (typeof CICLO_STATUS_PRE_USO)[number])) {
    return CYCLE_PRE_TTL_SEC;
  }
  return CYCLE_PRE_TTL_SEC; // outros (ex.: LIBERANDO se existir) tratados como pré-uso
}

/**
 * Retorna true se o registro está expirado pelo TTL.
 * refTs: updated_at ou created_at (ISO string).
 * ttlSeconds: TTL em segundos.
 */
export function isExpiredByTTL(
  refTs: string | null | undefined,
  ttlSeconds: number
): boolean {
  if (!refTs || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return false;
  const refMs = new Date(refTs).getTime();
  if (!Number.isFinite(refMs)) return false;
  return Date.now() > refMs + ttlSeconds * 1000;
}

/**
 * Para comando: usa expires_at como limite se existir; senão created_at + computeCommandTTLSeconds.
 */
export function isCommandExpired(cmdRow: CommandRow): boolean {
  const exp = cmdRow.expires_at;
  if (exp) {
    return new Date(exp).getTime() < Date.now();
  }
  const ref = cmdRow.updated_at ?? cmdRow.created_at;
  const ttl = computeCommandTTLSeconds(cmdRow);
  return isExpiredByTTL(ref, ttl);
}

/**
 * Para ciclo pré-uso: ref = updated_at ?? created_at, TTL = computeCycleTTLSeconds.
 * Para EM_USO: não considerar expirado por TTL sem evidência de término (chamador deve checar busy_off).
 */
export function isCyclePreUseExpired(cycleRow: CycleRow): boolean {
  const status = String(cycleRow.status ?? "").toUpperCase();
  if (status === CICLO_STATUS_EM_USO) return false;
  const ref = cycleRow.updated_at ?? cycleRow.created_at;
  const ttl = computeCycleTTLSeconds(cycleRow);
  return isExpiredByTTL(ref, ttl);
}
