// app/api/pos/authorize/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Observação importante:
 * - Este arquivo evita depender de tipos gerados do Supabase.
 * - O client é tratado como `any` localmente para não estourar "public" vs "never" no build do Vercel.
 */

// ---------- Tipos de entrada/saída (simples, sem Supabase Database types) ----------
type AuthorizeBody = {
  pos_serial?: string; // opcional (pode vir por header também)
  identificador_local?: string; // "LAV-01" | "SEC-01"
  valor?: number; // ex.: 16.0
  origem?: string; // enum no Postgres (UDT). Ex.: "pos" | "pwa" etc (depende do seu schema)
  metadata?: Record<string, unknown>;
};

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

// ---------- Helpers SQL (via supabase.rpc("sql", { query })) ----------
// Mantemos isso porque você já tentou assim, mas agora sem tipagem restritiva.
async function sqlQuery(supabase: any, query: string): Promise<any[]> {
  // Se sua função RPC "sql" retorna { rows: [...] } ou retorna direto, ajusta aqui.
  // Pra ficar resiliente: tentamos os dois formatos.
  const { data, error } = await supabase.rpc("sql", { query });
  if (error) throw new Error(error.message);

  if (Array.isArray(data)) return data;
  if (data?.rows && Array.isArray(data.rows)) return data.rows;
  return [];
}

/**
 * Descobre o nome do UDT (User-Defined Type) de uma coluna (ex.: enum) no Postgres.
 * Ex.: schema="pagamentos", table="pagamentos", column="origem"
 */
async function getUdtName(supabase: any, tableName: string, columnName: string, schemaName = "public") {
  const q = `
    select udt_name
    from information_schema.columns
    where table_schema = '${schemaName}'
      and table_name = '${tableName}'
      and column_name = '${columnName}'
    limit 1;
  `.trim();

  const rows = await sqlQuery(supabase, q);
  const udt = rows?.[0]?.udt_name;
  return typeof udt === "string" && udt.length > 0 ? udt : null;
}

/**
 * Pega labels (valores) de um enum do Postgres (pg_enum).
 */
async function getEnumLabels(supabase: any, enumTypeName: string) {
  const q = `
    select e.enumlabel as label
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where t.typname = '${enumTypeName}'
    order by e.enumsortorder asc;
  `.trim();

  const rows = await sqlQuery(supabase, q);
  return rows.map((r) => r.label).filter((x: any) => typeof x === "string");
}

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    const supabase = (await createClient()) as any;

    // Body
    let body: AuthorizeBody | null = null;
    try {
      body = (await req.json()) as AuthorizeBody;
    } catch {
      body = null;
    }

    const headerPosSerial =
      req.headers.get("x-pos-serial") ||
      req.headers.get("x-device-serial") ||
      req.headers.get("x-serial");

    const pos_serial = (body?.pos_serial || headerPosSerial || "").trim();
    const identificador_local = (body?.identificador_local || "").trim();
    const valor = body?.valor;
    const origem = (body?.origem || "").trim();
    const metadata = body?.metadata ?? {};

    if (!pos_serial) return jsonError("POS serial ausente (body.pos_serial ou header x-pos-serial).", 400);
    if (!identificador_local) return jsonError("identificador_local ausente (ex.: LAV-01 / SEC-01).", 400);
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
      return jsonError("valor inválido.", 400);
    }
    if (!origem) return jsonError("origem ausente.", 400);

    // 1) Validar POS Device
    const { data: posDevice, error: posErr } = await supabase
      .from("pos_devices")
      .select("id, serial, condominio_id")
      .eq("serial", pos_serial)
      .maybeSingle();

    if (posErr) return jsonError("Erro ao buscar pos_devices.", 500, { details: posErr.message });
    if (!posDevice) return jsonError("POS não cadastrado (pos_devices).", 401);

    const condominio_id = posDevice.condominio_id;

    // 2) Buscar máquina do condomínio pelo identificador_local
    const { data: maquina, error: maqErr } = await supabase
      .from("condominio_maquinas")
      .select("id, condominio_id, gateway_id, tipo_maquina, identificador_local")
      .eq("condominio_id", condominio_id)
      .eq("identificador_local", identificador_local)
      .maybeSingle();

    if (maqErr) return jsonError("Erro ao buscar condominio_maquinas.", 500, { details: maqErr.message });
    if (!maquina) return jsonError("Máquina não encontrada para esse POS/condomínio.", 404);
    if (!maquina.gateway_id) return jsonError("Máquina sem gateway_id vinculado.", 409);

    // 3) (Opcional) validar enum origem (sem quebrar build)
    // Se você não quiser validar aqui, pode remover esse bloco.
    // Ele é útil pra retornar 400 antes do insert estourar constraint.
    const udt_origem = await getUdtName(supabase, "pagamentos", "origem", "public");
    if (udt_origem) {
      const labels = await getEnumLabels(supabase, udt_origem);
      if (labels.length > 0 && !labels.includes(origem)) {
        return jsonError("origem inválida (fora do enum do banco).", 400, {
          allowed: labels,
        });
      }
    }

    // 4) Criar pagamento (status "authorized" / ajuste conforme seu schema)
    // Ajuste os campos conforme existirem no seu schema real.
    const pagamentoInsert: Record<string, any> = {
      condominio_id,
      maquina_id: maquina.id,
      pos_device_id: posDevice.id,
      gateway_id: maquina.gateway_id,
      valor,
      origem,
      status: "authorized",
      metadata,
    };

    const { data: pagamento, error: payErr } = await supabase
      .from("pagamentos")
      .insert(pagamentoInsert)
      .select("id, condominio_id, maquina_id, gateway_id, status, valor, origem, created_at")
      .single();

    if (payErr) {
      return jsonError("Erro ao criar pagamento.", 500, { details: payErr.message });
    }

    // 5) Criar comando IoT para o gateway (1 pulso = 1 ciclo)
    // Ajuste nomes de campos/estrutura conforme seu schema.
    const com
