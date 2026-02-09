export type Channel = "pos" | "mobile" | "web" | "kiosk";
export type ServiceType = "lavadora" | "secadora";

export type Origin = {
  pos_device_id: string | null;
  user_id: string | null;
};

export type RequestContext = {
  channel: Channel;
  origin: Origin;
};

export type QuoteRef = {
  quote_id: string;
  amount: number;
  valid_until: string;
  pricing_hash: string;
  rule_id?: string | null;
};

export type AuthorizeInput = RequestContext & {
  pos_serial: string;
  identificador_local: string;
  valor_centavos: number;
  metodo: "PIX" | "CARTAO";
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  quote: QuoteRef | null;
};

export type AvailabilityInput = RequestContext & {
  condominio_id: string;
  condominio_maquinas_id: string;
  service_type: ServiceType;
};

export type PriceInput = RequestContext & {
  condominio_id: string;
  condominio_maquinas_id: string;
  service_type: ServiceType;
  context: {
    coupon_code: string | null;
  };
};

export type ConfirmInput = RequestContext & {
  payment_id: string;
  provider: "stone" | "asaas";
  provider_ref: string;
  result: "approved" | "failed";
};

export type ExecuteCycleInput = RequestContext & {
  idempotency_key: string;
  payment_id: string;
  condominio_maquinas_id: string;
};

function toCentavos(body: any): number | null {
  if (typeof body?.valor_centavos === "number" && Number.isFinite(body.valor_centavos)) {
    const v = Math.trunc(body.valor_centavos);
    return v > 0 ? v : null;
  }
  if (typeof body?.valor === "number" && Number.isFinite(body.valor)) {
    const v = Math.round(body.valor * 100);
    return v > 0 ? v : null;
  }
  return null;
}

function normalizeChannel(v: unknown): Channel {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "mobile" || s === "web" || s === "kiosk") return s;
  return "pos";
}

function normalizeServiceType(v: unknown): ServiceType | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "lavadora" || s === "secadora") return s;
  if (s === "lavar") return "lavadora";
  if (s === "secar") return "secadora";
  return null;
}

function parseQuoteRef(body: any): QuoteRef | null {
  const quote = body?.quote ?? null;
  if (!quote || typeof quote !== "object") return null;

  const quote_id = String(quote.quote_id ?? "").trim();
  const amount = Number(quote.amount);
  const valid_until = String(quote.valid_until ?? "").trim();
  const pricing_hash = String(quote.pricing_hash ?? "").trim();
  const rule_id = quote.rule_id ? String(quote.rule_id) : null;

  if (!quote_id || !Number.isFinite(amount) || amount <= 0 || !valid_until || !pricing_hash) {
    return null;
  }

  return {
    quote_id,
    amount,
    valid_until,
    pricing_hash,
    rule_id,
  };
}

export function parseAuthorizeInput(
  req: Request,
  body: any
):
  | { ok: true; data: AuthorizeInput }
  | { ok: false; code: string; message: string } {
  const headerPosSerial =
    req.headers.get("x-pos-serial") ||
    req.headers.get("x-device-serial") ||
    req.headers.get("x-serial") ||
    "";

  const pos_serial = String(body?.pos_serial || headerPosSerial).trim();
  const identificador_local = String(body?.identificador_local || "").trim();
  const metodo = String(body?.metodo || "").trim().toUpperCase();

  const channel = normalizeChannel(body?.channel);
  const origin: Origin = {
    pos_device_id: body?.origin?.pos_device_id ? String(body.origin.pos_device_id) : null,
    user_id: body?.origin?.user_id ? String(body.origin.user_id) : null,
  };

  const quote = parseQuoteRef(body);
  const valor_centavos_from_body = toCentavos(body);
  const valor_centavos = quote ? Math.round(quote.amount * 100) : valor_centavos_from_body;

  if (!pos_serial)
    return {
      ok: false,
      code: "missing_pos_serial",
      message: "POS serial ausente (body.pos_serial ou header x-pos-serial).",
    };
  if (!identificador_local)
    return {
      ok: false,
      code: "missing_identificador_local",
      message: "identificador_local ausente (ex.: LAV-01 / SEC-01).",
    };
  if (!valor_centavos)
    return {
      ok: false,
      code: "invalid_amount",
      message: "valor inválido (use valor_centavos/valor legado ou quote.amount).",
    };
  if (metodo !== "PIX" && metodo !== "CARTAO")
    return { ok: false, code: "invalid_payment_method", message: "metodo inválido (PIX | CARTAO)." };

  const idempotencyHeader = req.headers.get("x-idempotency-key") || req.headers.get("idempotency-key") || "";
  const idempotency_key = String(body?.idempotency_key || idempotencyHeader || "").trim() || null;

  return {
    ok: true,
    data: {
      channel,
      origin,
      pos_serial,
      identificador_local,
      valor_centavos,
      metodo,
      idempotency_key,
      metadata: (body?.metadata ?? {}) as Record<string, unknown>,
      quote,
    },
  };
}

export function parseAvailabilityInput(body: any):
  | { ok: true; data: AvailabilityInput }
  | { ok: false; code: string; message: string } {
  const channel = normalizeChannel(body?.channel);
  const origin: Origin = {
    pos_device_id: body?.origin?.pos_device_id ? String(body.origin.pos_device_id) : null,
    user_id: body?.origin?.user_id ? String(body.origin.user_id) : null,
  };

  const condominio_id = String(body?.condominio_id || "").trim();
  const condominio_maquinas_id = String(body?.condominio_maquinas_id || "").trim();
  const service_type = normalizeServiceType(body?.service_type);

  if (!condominio_id) return { ok: false, code: "missing_condominio_id", message: "condominio_id é obrigatório." };
  if (!condominio_maquinas_id)
    return { ok: false, code: "missing_condominio_maquinas_id", message: "condominio_maquinas_id é obrigatório." };
  if (!service_type)
    return { ok: false, code: "invalid_service_type", message: "service_type inválido (lavadora|secadora)." };

  return {
    ok: true,
    data: {
      channel,
      origin,
      condominio_id,
      condominio_maquinas_id,
      service_type,
    },
  };
}

export function parsePriceInput(body: any):
  | { ok: true; data: PriceInput }
  | { ok: false; code: string; message: string } {
  const base = parseAvailabilityInput(body);
  if (!base.ok) return base;

  const couponRaw = body?.context?.coupon_code;
  const coupon_code = couponRaw ? String(couponRaw).trim() : null;

  return {
    ok: true,
    data: {
      ...base.data,
      context: { coupon_code },
    },
  };
}

export function parseConfirmInput(body: any):
  | { ok: true; data: ConfirmInput }
  | { ok: false; code: string; message: string } {
  const channel = normalizeChannel(body?.channel);
  const origin: Origin = {
    pos_device_id: body?.origin?.pos_device_id ? String(body.origin.pos_device_id) : null,
    user_id: body?.origin?.user_id ? String(body.origin.user_id) : null,
  };

  const payment_id = String(body?.payment_id || "").trim();
  const providerRaw = String(body?.provider || "").trim().toLowerCase();
  const provider = providerRaw === "asaas" ? "asaas" : providerRaw === "stone" ? "stone" : null;
  const provider_ref = String(body?.provider_ref || "").trim();
  const resultRaw = String(body?.result || "").trim().toLowerCase();
  const result = resultRaw === "approved" ? "approved" : resultRaw === "failed" ? "failed" : null;

  if (!payment_id) return { ok: false, code: "missing_payment_id", message: "payment_id é obrigatório." };
  if (!provider) return { ok: false, code: "invalid_provider", message: "provider inválido (stone|asaas)." };
  if (!provider_ref) return { ok: false, code: "missing_provider_ref", message: "provider_ref é obrigatório." };
  if (!result) return { ok: false, code: "invalid_result", message: "result inválido (approved|failed)." };

  return {
    ok: true,
    data: {
      channel,
      origin,
      payment_id,
      provider,
      provider_ref,
      result,
    },
  };
}

export function parseExecuteCycleInput(body: any):
  | { ok: true; data: ExecuteCycleInput }
  | { ok: false; code: string; message: string } {
  const channel = normalizeChannel(body?.channel);
  const origin: Origin = {
    pos_device_id: body?.origin?.pos_device_id ? String(body.origin.pos_device_id) : null,
    user_id: body?.origin?.user_id ? String(body.origin.user_id) : null,
  };

  const idempotency_key = String(body?.idempotency_key || "").trim();
  const payment_id = String(body?.payment_id || "").trim();
  const condominio_maquinas_id = String(body?.condominio_maquinas_id || "").trim();

  if (!idempotency_key) return { ok: false, code: "missing_idempotency_key", message: "idempotency_key é obrigatório." };
  if (!payment_id) return { ok: false, code: "missing_payment_id", message: "payment_id é obrigatório." };
  if (!condominio_maquinas_id)
    return { ok: false, code: "missing_condominio_maquinas_id", message: "condominio_maquinas_id é obrigatório." };

  return {
    ok: true,
    data: {
      channel,
      origin,
      idempotency_key,
      payment_id,
      condominio_maquinas_id,
    },
  };
}
