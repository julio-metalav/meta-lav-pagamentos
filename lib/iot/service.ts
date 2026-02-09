import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PollInput = {
  req: Request;
  limit: number;
  nowIso?: string;
};

type PollOk = {
  status: 200;
  body: {
    ok: true;
    gateway_id: string;
    serial: string | null;
    commands: Array<{
      id: string;
      cmd_id: string;
      tipo: string;
      payload: unknown;
      expires_at: string | null;
      created_at: string;
    }>;
  };
};

type PollErr = {
  status: number;
  body: {
    ok: false;
    error: string;
    detail?: string;
    [k: string]: unknown;
  };
};

function bad(message: string, status = 400, extra?: Record<string, unknown>): PollErr {
  return { status, body: { ok: false, error: message, ...(extra ?? {}) } };
}

export async function pollCommands(input: PollInput): Promise<PollOk | PollErr> {
  try {
    const { req, limit } = input;
    const nowIso = input.nowIso ?? new Date().toISOString();

    const url = new URL(req.url);
    const admin = supabaseAdmin() as any;

    let gatewayId: string | null = null;
    let serial: string | null = null;

    // Produção: autenticação HMAC
    const auth = authenticateGateway(req as any, ""); // GET sem body

    if (auth.ok) {
      serial = auth.serial;

      const { data: gw, error: gwErr } = await admin
        .from("gateways")
        .select("id, serial")
        .eq("serial", serial)
        .maybeSingle();

      if (gwErr) return bad("db_error", 500, { detail: gwErr.message });
      if (!gw) return bad("gateway_not_found", 404);

      gatewayId = gw.id;
    } else {
      // Dev fallback (somente fora de produção)
      if (process.env.NODE_ENV === "production") {
        return {
          status: auth.status ?? 401,
          body: {
            ok: false,
            error: auth.error,
            ...(auth.detail ? { detail: auth.detail } : {}),
          },
        };
      }

      gatewayId = url.searchParams.get("gateway_id");
      if (!gatewayId) return bad("missing_gateway_id", 400, { detail: "Em dev, informe gateway_id" });

      // best effort para serial na resposta
      try {
        const { data: gw } = await admin.from("gateways").select("id, serial").eq("id", gatewayId).maybeSingle();
        if (gw?.serial) serial = gw.serial;
      } catch {}
    }

    // Buscar comandos pendentes
    const { data: cmds, error: cmdErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, tipo, payload, status, expires_at, created_at")
      .eq("gateway_id", gatewayId)
      .in("status", ["pendente", "PENDENTE"])
      .is("ack_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (cmdErr) return bad("db_error", 500, { detail: cmdErr.message });

    const list = cmds ?? [];

    // Marcar como ENVIADO (idempotente)
    if (list.length > 0) {
      const ids = list.map((c: any) => c.id);
      const { error: upErr } = await admin
        .from("iot_commands")
        .update({ status: "ENVIADO" })
        .in("id", ids)
        .eq("gateway_id", gatewayId)
        .in("status", ["pendente", "PENDENTE"]);

      if (upErr) return bad("db_error", 500, { detail: upErr.message });
    }

    // Atualiza last_seen_at (best effort)
    try {
      await admin.from("gateways").update({ last_seen_at: nowIso }).eq("id", gatewayId);
    } catch {}

    return {
      status: 200,
      body: {
        ok: true,
        gateway_id: gatewayId!,
        serial,
        commands: list.map((c: any) => ({
          id: c.id,
          cmd_id: c.cmd_id,
          tipo: c.tipo,
          payload: c.payload,
          expires_at: c.expires_at,
          created_at: c.created_at,
        })),
      },
    };
  } catch (e: any) {
    return bad("internal_error", 500, { detail: String(e?.message ?? e) });
  }
}

export async function ackCommand() {
  throw new Error("NOT_IMPLEMENTED");
}

export async function recordEvento() {
  throw new Error("NOT_IMPLEMENTED");
}
