import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDefaultTenantId } from "@/lib/tenant";

type EnqueueResult = {
  status: number;
  body: Record<string, unknown>;
};

function bad(message: string, status = 400): EnqueueResult {
  return { status, body: { ok: false, error: message } };
}

function isDevAuthorized(req: Request) {
  if (process.env.NODE_ENV === "production") return false;
  const secret = process.env.DEV_ENQUEUE_SECRET;
  if (!secret) return true;
  const got = req.headers.get("x-dev-secret") || "";
  return got === secret;
}

export async function enqueueDevCommand(req: Request): Promise<EnqueueResult> {
  try {
    if (!isDevAuthorized(req)) return bad("Não autorizado", 401);

    const body = await req.json().catch(() => ({}));
    const serial = String(body.serial || "").trim();
    const tipo = String(body.type || body.tipo || "PULSE").trim().toUpperCase();
    const payload = body.payload ?? { pulses: 1 };
    const condominioMaquinasIdInput = String(body.condominio_maquinas_id || "").trim();

    if (!serial) return bad("serial é obrigatório");

    const tenantId = getDefaultTenantId();
    const admin = supabaseAdmin();

    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, serial")
      .eq("tenant_id", tenantId)
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad(gwErr.message, 500);
    if (!gw?.id) return bad("gateway não encontrado para serial informado", 404);

    let condominioMaquinasId = condominioMaquinasIdInput;

    if (!condominioMaquinasId) {
      const { data: maq, error: maqErr } = await admin
        .from("condominio_maquinas")
        .select("id, gateway_id, ativa, identificador_local, tipo")
        .eq("tenant_id", tenantId)
        .eq("gateway_id", gw.id)
        .eq("ativa", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maqErr) return bad(maqErr.message, 500);
      if (!maq?.id) return bad("nenhuma máquina ativa vinculada ao gateway", 409);
      condominioMaquinasId = maq.id;
    }

    const cmd_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from("iot_commands")
      .insert({
        tenant_id: tenantId,
        gateway_id: gw.id,
        condominio_maquinas_id: condominioMaquinasId,
        cmd_id,
        tipo,
        payload,
        // status canônico PT-BR do runtime
        status: "PENDENTE",
        expires_at,
      })
      .select("id, cmd_id, gateway_id, condominio_maquinas_id, tipo, payload, status, created_at")
      .single();

    if (error) return bad(error.message, 500);

    return { status: 200, body: { ok: true, queued: data } };
  } catch (e: any) {
    return bad(e?.message || "Erro interno", 500);
  }
}
