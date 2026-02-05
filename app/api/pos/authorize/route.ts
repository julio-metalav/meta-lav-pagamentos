import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POS Authorize (Stone)
 *
 * Cria:
 *  - 1 registro em public.pagamentos (venda)
 *  - 1 comando em public.iot_commands (PULSE)
 *
 * Regras:
 *  - Backend é a fonte da verdade.
 *  - POS não decide nada; apenas solicita.
 *  - Enum labels são resolvidos dinamicamente do Postgres via RPC public.sql (read-only).
 *
 * Segurança:
 *  - Header obrigatório: X-POS-KEY = process.env.POS_API_KEY
 *
 * Tabelas oficiais (PT):
 *  - condominio_maquinas
 *  - gateways
 *  - pagamentos
 *  - iot_commands
 */

type AuthorizeBody = {
  pos_device_id: string; // uuid
  maquina_id: string; // uuid = condominio_maquinas.id
  metodo: "PIX" | "CARD" | string;
  gateway_pagamento?: string; // ex: "STONE" | "ASAAS" etc
  valor_centavos?: number; // por enquanto vem do POS (até precos_ciclo estar populado)
  idempotency_key: string;
  origem?: string; // default POS
};

function jsonError(status: number, message: string, extra?: Record<string, any>) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status }
  );
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalize(s: string) {
  return (s ?? "").trim().toLowerCase();
}

function looksLikeUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function escapeSqlLiteral(s: string) {
  return String(s ?? "").replace(/'/g, "''");
}

/**
 * Busca udt_name do Postgres via RPC public.sql (evita TS "never" + evita depender de FROM information_schema via REST)
 */
async function getUdtName(
  supabase: ReturnType<typeof createClient>,
  table: string,
  column: string
): Promise<string | null> {
  const t = escapeSqlLiteral(table);
  const c = escapeSqlLiteral(column);

  const q = `
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = '${t}'
      and column_name = '${c}'
    limit 1
  `;

  const { data, error } = await supabase.rpc("sql", { query: q });
  if (error) {
    throw new Error(`Failed to read udt_name for ${table}.${column}: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length === 0) return null;
  const udt = (data[0] as any)?.udt_name;
  return udt ? String(udt) : null;
}

async function getEnumLabelsByTypeName(
  supabase: ReturnType<typeof createClient>,
  typeName: string
): Promise<string[]> {
  const typ = escapeSqlLiteral(typeName);
  const q = `
    select e.enumlabel as label
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = '${typ}'
    order by e.enumsortorder asc
  `;

  const { data, error } = await supabase.rpc("sql", { query: q });

  if (error) return [];
  if (!Array.isArray(data)) return [];

  return data
    .map((x: any) => (x && typeof x === "object" ? String(x.label ?? "") : ""))
    .filter(Boolean);
}

function pickEnumLabel(labels: string[], wanted: string, aliases?: Record<string, string[]>) {
  if (!labels.length) return wanted;

  const w = normalize(wanted);

  const direct = labels.find((l) => normalize(l) === w);
  if (direct) return direct;

  const contains = labels.find((l) => normalize(l).includes(w) || w.includes(normalize(l)));
  if (contains) return contains;

  if (aliases) {
    for (const [canon, keys] of Object.entries(aliases)) {
      const all = [canon, ...keys].map(normalize);
      if (all.includes(w)) {
        const hit = labels.find((l) => normalize(l) === normalize(canon));
        if (hit) return hit;

        const hit2 = labels.find((l) => normalize(l).includes(normalize(canon)));
        if (hit2) return hit2;
      }
    }
  }

  return labels[0];
}

export async function POST(req: NextRequest) {
  try {
    // 1) Auth simples do POS
    const posKey = req.headers.get("x-pos-key") || "";
    const expected = requireEnv("POS_API_KEY");
    if (!posKey || posKey !== expected) {
      return jsonError(401, "POS não autorizado (X-POS-KEY inválido).");
    }

    // 2) Supabase service role (bypass RLS)
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 3) Body
    const body = (await req.json()) as Partial<AuthorizeBody>;
    const pos_device_id = String(body.pos_device_id ?? "");
    const maquina_id = String(body.maquina_id ?? "");
    const metodo = String(body.metodo ?? "");
    const gateway_pagamento = String(body.gateway_pagamento ?? "STONE");
    const idempotency_key = String(body.idempotency_key ?? "");
    const origem = String(body.origem ?? "POS");

    const valor_centavos =
      body.valor_centavos === undefined || body.valor_centavos === null
        ? null
        : Number(body.valor_centavos);

    if (!looksLikeUUID(pos_device_id)) return jsonError(400, "pos_device_id inválido (UUID).");
    if (!looksLikeUUID(maquina_id)) return jsonError(400, "maquina_id inválido (UUID).");
    if (!idempotency_key || idempotency_key.length < 8)
      return jsonError(400, "idempotency_key obrigatório (mín 8 chars).");
    if (!metodo) return jsonError(400, "metodo obrigatório (PIX ou CARD).");

    // 4) Idempotência
    {
      const { data: existing, error } = await supabase
        .from("pagamentos")
        .select("id, status, valor_centavos, maquina_id, condominio_id, created_at, paid_at")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();

      if (error) throw new Error(`Erro buscando idempotency_key: ${error.message}`);
      if (existing) {
        return NextResponse.json({
          ok: true,
          reused: true,
          pagamento_id: existing.id,
          status: existing.status,
          valor_centavos: existing.valor_centavos,
          maquina_id: existing.maquina_id,
          condominio_id: existing.condominio_id,
        });
      }
    }

    // 5) Busca máquina + validações
    const { data: maquina, error: maquinaErr } = await supabase
      .from("condominio_maquinas")
      .select(
        "id, condominio_id, ativa, gateway_id, identificador_local, duracao_ciclo_min, buffer_retirada_min"
      )
      .eq("id", maquina_id)
      .maybeSingle();

    if (maquinaErr) throw new Error(`Erro lendo condominio_maquinas: ${maquinaErr.message}`);
    if (!maquina) return jsonError(404, "Máquina não encontrada.");
    if (!maquina.ativa) return jsonError(409, "Máquina inativa.");
    if (!maquina.gateway_id) return jsonError(409, "Máquina sem gateway_id vinculado.");

    // 6) Preço (por enquanto exigimos valor_centavos no request)
    if (valor_centavos === null || !Number.isFinite(valor_centavos) || valor_centavos <= 0) {
      return jsonError(
        400,
        "valor_centavos obrigatório por enquanto (até precos_ciclo estar definido)."
      );
    }

    // 7) Enum resolution (via udt_name + pg_enum)
    const udt_origem = await getUdtName(supabase, "pagamentos", "origem");
    const udt_metodo = await getUdtName(supabase, "pagamentos", "metodo");
    const udt_gateway = await getUdtName(supabase, "pagamentos", "gateway_pagamento");
    const udt_status = await getUdtName(supabase, "pagamentos", "status");

    const origemLabels = udt_origem ? await getEnumLabelsByTypeName(supabase, udt_origem) : [];
    const metodoLabels = udt_metodo ? await getEnumLabelsByTypeName(supabase, udt_metodo) : [];
    const gatewayLabels = udt_gateway ? await getEnumLabelsByTypeName(supabase, udt_gateway) : [];
    const statusLabels = udt_status ? await getEnumLabelsByTypeName(supabase, udt_status) : [];

    const origemValue = pickEnumLabel(origemLabels, origem);

    const metodoValue = pickEnumLabel(metodoLabels, metodo, {
      PIX: ["pix"],
      CARD: ["card", "cartao", "cartão", "credito", "crédito", "debito", "débito"],
    });

    const gatewayValue = pickEnumLabel(gatewayLabels, gateway_pagamento);

    // tenta achar algo tipo AUTHORIZED/AUTORIZADO etc; fallback = primeiro label
    const statusValue = pickEnumLabel(statusLabels, "AUTHORIZED", {
      AUTHORIZED: ["autorizado", "autorizada", "authorized", "auth"],
      CREATED: ["criado", "created"],
      PENDING: ["pendente", "pending"],
    });

    // 8) Cria venda (pagamentos)
    const pagamentoInsert: any = {
      condominio_id: maquina.condominio_id,
      maquina_id: maquina.id,
      origem: origemValue,
      metodo: metodoValue,
      gateway_pagamento: gatewayValue,
      valor_centavos: valor_centavos,
      status: statusValue,
      idempotency_key,
      external_id: null,
      paid_at: null,
    };

    const { data: pagamento, error: pagErr } = await supabase
      .from("pagamentos")
      .insert(pagamentoInsert)
      .select("id, condominio_id, maquina_id, status, valor_centavos, created_at")
      .single();

    if (pagErr) {
      throw new Error(`Falha ao inserir em pagamentos: ${pagErr.message}`);
    }

    // 9) Cria comando IoT (fila oficial)
    const cmdId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min

    const commandPayload = {
      pulses: 1,
      pulse_ms: 120,
      pagamento_id: pagamento.id,
      machine_local_id: maquina.identificador_local,
    };

    const { data: cmdRow, error: cmdErr } = await supabase
      .from("iot_commands")
      .insert({
        gateway_id: maquina.gateway_id,
        condominio_maquinas_id: maquina.id,
        cmd_id: cmdId,
        tipo: "PULSE",
        payload: commandPayload,
        status: "queued",
        expires_at: expiresAt,
      })
      .select("id, cmd_id, status, expires_at, created_at")
      .single();

    if (cmdErr) {
      throw new Error(`Falha ao inserir em iot_commands: ${cmdErr.message}`);
    }

    return NextResponse.json({
      ok: true,
      reused: false,
      pagamento_id: pagamento.id,
      pagamento_status: pagamento.status,
      valor_centavos: pagamento.valor_centavos,
      cmd: {
        id: cmdRow.id,
        cmd_id: cmdRow.cmd_id,
        status: cmdRow.status,
        expires_at: cmdRow.expires_at,
      },
      maquina: {
        id: maquina.id,
        identificador_local: maquina.identificador_local,
        gateway_id: maquina.gateway_id,
        duracao_ciclo_min: maquina.duracao_ciclo_min,
        buffer_retirada_min: maquina.buffer_retirada_min,
      },
    });
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "Erro inesperado.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
