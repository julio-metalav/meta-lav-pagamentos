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
    const ackAtIso = new Date(ts * 1000).toISOString();

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

    // Atualiza comando
    const newStatus: "ACK" | "FALHOU" = ok ? "ACK" : "FALHOU";

    const { error: upErr } = await admin
      .from("iot_commands")
      .update({ status: newStatus, ack_at: ackAtIso })
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

function toIntAny(v: any, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTipoEvento(input: string) {
  const t = String(input || "").trim().toUpperCase();
  if (t === "PULSE" || t === "PULSO_ENVIADO") return "PULSO_ENVIADO";
  if (t === "BUSY_ON") return "BUSY_ON";
  if (t === "BUSY_OFF") return "BUSY_OFF";
  if (t === "HEARTBEAT") return "HEARTBEAT";
  if (t === "ERRO" || t === "ERROR") return "ERRO";
  return "";
}

function pickCicloIdFromCmd(cmdRow: any): string {
  const p = cmdRow?.payload ?? null;
  const c = (p?.ciclo_id ?? "") || (p?.cicloId ?? "") || (p?.ciclo?.id ?? "") || (p?.ciclo?.ciclo_id ?? "") || (p?.payload?.ciclo_id ?? "") || "";
  return c ? String(c) : "";
}

type EventoInput = { req: Request };
type EventoResult = { status: number; body: Record<string, unknown> };

type HeartbeatInput = { req: Request };
type HeartbeatResult = { status: number; body: Record<string, unknown> };

export async function recordEvento(input: EventoInput): Promise<EventoResult> {
  const req = input.req;
  const serial = (req.headers.get("x-gw-serial") || "").trim();
  const ts = (req.headers.get("x-gw-ts") || "").trim();
  const sign = (req.headers.get("x-gw-sign") || "").trim();

  if (!serial || !ts || !sign) {
    return { status: 400, body: { ok: false, error: "headers_missing" } };
  }

  const rawBody = await req.text();
  const { verifyHmac } = await import("@/lib/libiot-hmac");
  const { ok: hmacOk, debug } = verifyHmac({ serial, ts, receivedHex: sign, rawBody });

  if (!hmacOk) {
    const debugOn = process.env.DEBUG_HMAC === "1";
    console.log("[IOT_EVENTO] invalid_hmac", {
      serial: (debug as any).serial,
      ts: (debug as any).ts,
      rawBodyLen: (debug as any).rawBodyLen,
      error: (debug as any).error,
    });

    return {
      status: 401,
      body: { ok: false, error: "invalid_hmac", ...(debugOn ? { debug } : {}) },
    };
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }

  const tipoIn = String(payload?.type ?? "");
  const tipo = normalizeTipoEvento(tipoIn);
  if (!tipo) return { status: 400, body: { ok: false, error: "missing_or_invalid_type", received: tipoIn } };

  const tsGw = toIntAny(ts, NaN);
  if (!Number.isFinite(tsGw)) return { status: 400, body: { ok: false, error: "invalid_ts" } };

  const admin = supabaseAdmin() as any;
  const eventoIso = new Date(tsGw * 1000).toISOString();

  const { data: gw, error: gwErr } = await admin.from("gateways").select("id, serial, condominio_id").eq("serial", serial).maybeSingle();
  if (gwErr) return { status: 500, body: { ok: false, error: "db_error", detail: gwErr.message } };
  if (!gw) return { status: 404, body: { ok: false, error: "gateway_not_found" } };

  const machineIdent = payload?.machine_id ? String(payload.machine_id).trim() : "";
  const cmdId = payload?.cmd_id ? String(payload.cmd_id).trim() : "";

  let condominioMaquinasId: string | null = null;
  let cmdRow: any = null;
  if (cmdId) {
    const { data: c, error: cErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, status, tipo, payload, condominio_maquinas_id")
      .eq("gateway_id", gw.id)
      .eq("cmd_id", cmdId)
      .maybeSingle();

    if (cErr) return { status: 500, body: { ok: false, error: "db_error", detail: cErr.message } };
    cmdRow = c ?? null;
    if (cmdRow?.condominio_maquinas_id) condominioMaquinasId = String(cmdRow.condominio_maquinas_id);
  }

  if (!condominioMaquinasId && machineIdent) {
    const { data: m, error: mErr } = await admin
      .from("condominio_maquinas")
      .select("id, identificador_local, gateway_id, condominio_id")
      .eq("gateway_id", gw.id)
      .eq("identificador_local", machineIdent)
      .maybeSingle();

    if (mErr) return { status: 500, body: { ok: false, error: "db_error", detail: mErr.message } };
    if (m?.id) condominioMaquinasId = String(m.id);
  }

  const { data: evPt, error: evPtErr } = await admin
    .from("eventos_iot")
    .insert({ gateway_id: gw.id, maquina_id: condominioMaquinasId, tipo, payload: payload ?? {}, created_at: eventoIso })
    .select("id, created_at")
    .single();

  if (evPtErr || !evPt) {
    return { status: 500, body: { ok: false, error: "db_error", detail: evPtErr?.message ?? "insert_eventos_iot_failed" } };
  }

  const { data: evLegacy, error: evLegacyErr } = await admin
    .from("iot_eventos")
    .insert({ gw_serial: serial, ts_gw: tsGw, tipo, payload, raw_body: rawBody, hmac_ok: true })
    .select("id, created_at")
    .single();

  if (evLegacyErr || !evLegacy) {
    return {
      status: 200,
      body: {
        ok: true,
        evento_id: evPt.id,
        created_at: evPt.created_at,
        warning: "legacy_iot_eventos_insert_failed",
        legacy_detail: evLegacyErr?.message ?? "unknown",
      },
    };
  }

  const cicloId: string = pickCicloIdFromCmd(cmdRow);

  async function updateCicloById(upd: any, whereStatus?: string) {
    if (!cicloId) return { did: false, reason: "no_ciclo_id" };
    let q = admin.from("ciclos").update(upd).eq("id", cicloId);
    if (whereStatus) q = q.eq("status", whereStatus);
    const { data, error } = await q.select("id,status").maybeSingle();
    if (error) {
      console.log("[IOT_EVENTO] ciclo_update_error", { cicloId, tipo, error: error.message });
      return { did: false, reason: "db_error", error: error.message };
    }
    return { did: !!data, data };
  }

  async function updateCicloFallbackByMachine(kind: "BUSY_ON" | "BUSY_OFF" | "PULSO_ENVIADO") {
    if (!condominioMaquinasId) return { did: false, reason: "no_machine" };

    if (kind === "BUSY_ON") {
      const { data: c, error } = await admin
        .from("ciclos")
        .select("id,status,pulso_enviado_at,created_at")
        .eq("maquina_id", condominioMaquinasId)
        .eq("status", "LIBERADO")
        .is("busy_on_at", null)
        .order("pulso_enviado_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return { did: false, reason: "db_error", error: error.message };
      if (!c?.id) return { did: false, reason: "no_candidate" };

      const { data: u, error: uErr } = await admin
        .from("ciclos")
        .update({ busy_on_at: eventoIso, status: "EM_USO" })
        .eq("id", c.id)
        .eq("status", "LIBERADO")
        .select("id,status")
        .maybeSingle();
      if (uErr) return { did: false, reason: "db_error", error: uErr.message };
      return { did: !!u, data: u, picked_ciclo_id: c.id };
    }

    if (kind === "BUSY_OFF") {
      const { data: c, error } = await admin
        .from("ciclos")
        .select("id,status,busy_on_at,created_at")
        .eq("maquina_id", condominioMaquinasId)
        .eq("status", "EM_USO")
        .is("busy_off_at", null)
        .order("busy_on_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { did: false, reason: "db_error", error: error.message };
      if (!c?.id) return { did: false, reason: "no_candidate" };

      const { data: u, error: uErr } = await admin
        .from("ciclos")
        .update({ busy_off_at: eventoIso, status: "FINALIZADO" })
        .eq("id", c.id)
        .eq("status", "EM_USO")
        .select("id,status")
        .maybeSingle();
      if (uErr) return { did: false, reason: "db_error", error: uErr.message };
      return { did: !!u, data: u, picked_ciclo_id: c.id };
    }

    const { data: list, error } = await admin
      .from("ciclos")
      .select("id,created_at,status")
      .eq("maquina_id", condominioMaquinasId)
      .eq("status", "AGUARDANDO_LIBERACAO")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return { did: false, reason: "db_error", error: error.message };
    const c = (list || [])[0];
    if (!c?.id) return { did: false, reason: "no_candidate" };

    const { data: u, error: uErr } = await admin
      .from("ciclos")
      .update({ pulso_enviado_at: eventoIso, status: "LIBERADO" })
      .eq("id", c.id)
      .eq("status", "AGUARDANDO_LIBERACAO")
      .select("id,status")
      .maybeSingle();
    if (uErr) return { did: false, reason: "db_error", error: uErr.message };
    return { did: !!u, data: u, picked_ciclo_id: c.id };
  }

  if (tipo === "PULSO_ENVIADO") {
    const pulsesRaw = payload?.payload?.pulses ?? payload?.pulses ?? 1;
    const pulses = toIntAny(pulsesRaw, 1);
    if (!Number.isFinite(pulses) || pulses <= 0) {
      return { status: 400, body: { ok: false, error: "invalid_pulses", evento_id: evPt.id } };
    }

    if (cmdRow?.id) {
      const currStatus = String(cmdRow.status ?? "");
      if (currStatus === "ENVIADO" || currStatus === "ACK") {
        await admin.from("iot_commands").update({ status: "EXECUTADO" }).eq("id", cmdRow.id).eq("gateway_id", gw.id);
      }
    }

    let cicloUpd = await updateCicloById({ pulso_enviado_at: eventoIso, status: "LIBERADO" }, "AGUARDANDO_LIBERACAO");
    let fallback: any = null;
    if (!cicloUpd.did) fallback = await updateCicloFallbackByMachine("PULSO_ENVIADO");

    return {
      status: 200,
      body: {
        ok: true,
        evento_id: evPt.id,
        created_at: evPt.created_at,
        legacy_evento_id: evLegacy.id,
        ciclos_criados: pulses,
        ciclo_atualizado: cicloUpd.did || !!fallback?.did,
        ciclo_update_source: cicloUpd.did ? "cmd_id" : fallback?.did ? "fallback_machine" : "none",
        ...(fallback?.picked_ciclo_id ? { ciclo_fallback_id: fallback.picked_ciclo_id } : {}),
      },
    };
  }

  if (tipo === "BUSY_ON") {
    let cicloUpd = await updateCicloById({ busy_on_at: eventoIso, status: "EM_USO" }, "LIBERADO");
    let fallback: any = null;
    if (!cicloUpd.did) fallback = await updateCicloFallbackByMachine("BUSY_ON");

    return {
      status: 200,
      body: {
        ok: true,
        evento_id: evPt.id,
        created_at: evPt.created_at,
        legacy_evento_id: evLegacy.id,
        ciclo_atualizado: cicloUpd.did || !!fallback?.did,
        ciclo_update_source: cicloUpd.did ? "cmd_id" : fallback?.did ? "fallback_machine" : "none",
        ...(fallback?.picked_ciclo_id ? { ciclo_fallback_id: fallback.picked_ciclo_id } : {}),
      },
    };
  }

  if (tipo === "BUSY_OFF") {
    let cicloUpd = await updateCicloById({ busy_off_at: eventoIso, status: "FINALIZADO" }, "EM_USO");
    let fallback: any = null;
    if (!cicloUpd.did) fallback = await updateCicloFallbackByMachine("BUSY_OFF");

    return {
      status: 200,
      body: {
        ok: true,
        evento_id: evPt.id,
        created_at: evPt.created_at,
        legacy_evento_id: evLegacy.id,
        ciclo_atualizado: cicloUpd.did || !!fallback?.did,
        ciclo_update_source: cicloUpd.did ? "cmd_id" : fallback?.did ? "fallback_machine" : "none",
        ...(fallback?.picked_ciclo_id ? { ciclo_fallback_id: fallback.picked_ciclo_id } : {}),
      },
    };
  }

  return { status: 200, body: { ok: true, evento_id: evPt.id, created_at: evPt.created_at, legacy_evento_id: evLegacy.id } };
}

export async function heartbeatGateway(input: HeartbeatInput): Promise<HeartbeatResult> {
  const req = input.req;
  const serial = req.headers.get("x-gw-serial") || "";
  const ts = req.headers.get("x-gw-ts") || "";
  const sign = req.headers.get("x-gw-sign") || "";

  if (!serial || !ts || !sign) {
    return { status: 400, body: { ok: false, error: "headers_missing" } };
  }

  const rawBody = await req.text();
  const auth = authenticateGateway(req, rawBody);
  if (!auth.ok) {
    return { status: 401, body: { ok: false, error: "invalid_hmac" } };
  }

  let payload: any = null;
  if (rawBody && rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { ok: false, error: "invalid_json" } };
    }
  }

  try {
    const admin = supabaseAdmin();
    await admin.from("gateways").update({ last_seen_at: new Date().toISOString() }).eq("serial", auth.serial);
  } catch {
    // best effort
  }

  return {
    status: 200,
    body: {
      ok: true,
      serial: auth.serial,
      ts: Number.parseInt(ts, 10),
      payload,
    },
  };
}
