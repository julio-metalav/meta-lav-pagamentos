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

type AckInput = {
  req: Request;
};

type AckOk = {
  status: 200;
  body: {
    ok: true;
    serial: string;
    cmd_id: string;
    status: "ACK" | "FALHOU";
  };
};

type AckErr = {
  status: number;
  body: {
    ok: false;
    error: string;
    detail?: string;
    [k: string]: unknown;
  };
};

export async function ackCommand(input: AckInput): Promise<AckOk | AckErr> {
  try {
    const rawBody = await input.req.text();

    // Auth HMAC (mesmo padrão do /poll)
    const auth = authenticateGateway(input.req, rawBody);
    if (!auth.ok) {
      return {
        status: auth.status ?? 401,
        body: {
          ok: false,
          error: auth.error,
          ...(auth.detail ? { detail: auth.detail } : {}),
        },
      };
    }

    const serial = auth.serial;

    // Parse JSON
    let data: any = {};
    try {
      data = JSON.parse(rawBody || "{}");
    } catch {
      return bad("invalid_json");
    }

    const cmdId = String(data?.cmd_id ?? "");
    const ok = data?.ok;
    const ts = Number.parseInt(String(data?.ts ?? ""), 10);

    if (!cmdId) return bad("invalid_payload", 400, { detail: "cmd_id obrigatório" });
    if (typeof ok !== "boolean") return bad("invalid_payload", 400, { detail: "ok deve ser boolean" });
    if (!Number.isFinite(ts)) return bad("invalid_payload", 400, { detail: "ts inválido" });

    const machineId = data?.machine_id ? String(data.machine_id) : null;
    const code = data?.code ? String(data.code) : null;

    const admin = supabaseAdmin() as any;
    const nowIso = new Date().toISOString();
    const createdAtIso = new Date(ts * 1000).toISOString();

    // Carrega gateway por serial
    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, serial")
      .eq("serial", serial)
      .maybeSingle();

    if (gwErr) return bad("db_error", 500, { detail: gwErr.message });
    if (!gw) return bad("gateway_not_found", 404);

    // Busca comando no schema PT-BR
    const { data: cmdRow, error: cmdErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, tipo, status, condominio_maquinas_id")
      .eq("gateway_id", gw.id)
      .eq("cmd_id", cmdId)
      .maybeSingle();

    if (cmdErr) return bad("db_error", 500, { detail: cmdErr.message });
    if (!cmdRow) return bad("cmd_not_found", 404);

    const cmdTipo = String(cmdRow.tipo ?? "UNKNOWN");

    // Log ACK
    const { error: ackErr } = await admin.from("iot_acks").insert({
      serial,
      machine_id: machineId,
      cmd_id: cmdId,
      cmd: cmdTipo,
      ok,
      code: code ?? null,
      payload: data,
      created_at: createdAtIso,
    });

    if (ackErr) return bad("db_error", 500, { detail: ackErr.message });

    // Atualiza comando
    const newStatus: "ACK" | "FALHOU" = ok ? "ACK" : "FALHOU";

    const { error: upErr } = await admin
      .from("iot_commands")
      .update({ status: newStatus, ack_at: nowIso })
      .eq("id", cmdRow.id)
      .eq("gateway_id", gw.id);

    if (upErr) return bad("db_error", 500, { detail: upErr.message });

    // last_seen_at best effort
    await admin.from("gateways").update({ last_seen_at: nowIso }).eq("id", gw.id);

    return { status: 200, body: { ok: true, serial, cmd_id: cmdId, status: newStatus } };
  } catch (e: any) {
    return bad("internal_error", 500, { detail: String(e?.message ?? e) });
  }
}

export async function recordEvento() {
  throw new Error("NOT_IMPLEMENTED");
}
