import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ScanResult = {
  status: number;
  body: Record<string, unknown>;
};

function bad(message: string, status = 400, extra?: Record<string, unknown>): ScanResult {
  return { status, body: { ok: false, error: message, ...(extra || {}) } };
}

function isAuthorized(req: Request) {
  const secret = process.env.PAYMENTS_COMPENSATION_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("x-compensation-secret") || "";
  return got === secret;
}

const DELIVERED_CYCLE_STATUSES = ["LIBERADO", "EM_USO", "FINALIZADO"];
const SAFE_PENDING_STATUSES = ["AGUARDANDO_LIBERACAO", "ABORTADO"];

export async function scanUndeliveredPaid(req: Request): Promise<ScanResult> {
  try {
    if (!isAuthorized(req)) return bad("Não autorizado", 401);

    const body = await req.json().catch(() => ({}));
    const slaSec = Number(body?.sla_sec || process.env.PAYMENTS_DELIVERY_SLA_SEC || 180);
    const limit = Math.min(200, Math.max(1, Number(body?.limit || 100)));
    const now = Date.now();
    const cutoffIso = new Date(now - slaSec * 1000).toISOString();

    const admin = supabaseAdmin() as any;

    const { data: candidates, error: candErr } = await admin
      .from("pagamentos")
      .select("id,status,paid_at,created_at,maquina_id,condominio_id")
      .eq("status", "PAGO")
      .not("paid_at", "is", null)
      .lte("paid_at", cutoffIso)
      .order("paid_at", { ascending: true })
      .limit(limit);

    if (candErr) return bad("Erro ao buscar pagamentos candidatos.", 500, { details: candErr.message });

    const rows = (candidates || []) as Array<{
      id: string;
      status: string;
      paid_at: string | null;
      created_at: string;
      maquina_id: string | null;
      condominio_id: string;
    }>;

    const marked: string[] = [];
    const skippedDelivered: string[] = [];
    const skippedActive: string[] = [];
    const errors: Array<{ payment_id: string; error: string }> = [];

    for (const p of rows) {
      const { data: cycle, error: cErr } = await admin
        .from("ciclos")
        .select("id,status,created_at")
        .eq("pagamento_id", p.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cErr) {
        errors.push({ payment_id: p.id, error: cErr.message });
        continue;
      }

      if (cycle && DELIVERED_CYCLE_STATUSES.includes(String(cycle.status || ""))) {
        skippedDelivered.push(p.id);
        continue;
      }

      if (cycle && !SAFE_PENDING_STATUSES.includes(String(cycle.status || ""))) {
        skippedActive.push(p.id);
        continue;
      }

      // Fase 1 W4 (sem estorno externo ainda): marcar pagamento como EXPIRADO
      // para acionar trilha de compensação em fase seguinte.
      const { data: updated, error: uErr } = await admin
        .from("pagamentos")
        .update({ status: "EXPIRADO" })
        .eq("id", p.id)
        .eq("status", "PAGO")
        .select("id,status")
        .maybeSingle();

      if (uErr) {
        errors.push({ payment_id: p.id, error: uErr.message });
        continue;
      }

      if (updated?.id) {
        marked.push(updated.id);
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        mode: "phase1-marker",
        marker_status: "EXPIRADO",
        sla_sec: slaSec,
        scanned: rows.length,
        marked_count: marked.length,
        marked,
        skipped_delivered_count: skippedDelivered.length,
        skipped_active_count: skippedActive.length,
        error_count: errors.length,
        errors,
      },
    };
  } catch (e: any) {
    return bad("Erro interno no scan de compensação.", 500, { details: e?.message || String(e) });
  }
}
