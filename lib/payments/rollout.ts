export type CanaryMode = "off" | "allowlist" | "blocklist";

function parseCsvSet(raw: string | undefined): Set<string> {
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function getPosCanaryConfig() {
  const modeRaw = String(process.env.PAYMENTS_POS_CANARY_MODE || "off").trim().toLowerCase();
  const mode: CanaryMode = modeRaw === "allowlist" || modeRaw === "blocklist" ? modeRaw : "off";

  const allow = parseCsvSet(process.env.PAYMENTS_POS_CANARY_ALLOWLIST);
  const block = parseCsvSet(process.env.PAYMENTS_POS_CANARY_BLOCKLIST);

  return { mode, allow, block };
}

export function isPosCanaryAllowed(condominioId: string) {
  const id = String(condominioId || "").trim();
  const { mode, allow, block } = getPosCanaryConfig();

  if (!id) return { allowed: false, reason: "missing_condominio_id", mode };
  if (mode === "off") return { allowed: true, reason: "mode_off", mode };

  if (mode === "allowlist") {
    const ok = allow.has(id);
    return { allowed: ok, reason: ok ? "allowlist_match" : "allowlist_miss", mode };
  }

  // blocklist
  const blocked = block.has(id);
  return { allowed: !blocked, reason: blocked ? "blocklist_match" : "blocklist_miss", mode };
}
