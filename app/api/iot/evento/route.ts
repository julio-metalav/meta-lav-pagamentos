// app/api/iot/evento/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyHmac } from "@/lib/libiot-hmac";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function toInt(v: any, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTipo(input: string) {
  const t = String(input || "").trim().toUpperCase();

  // Aceita tanto o legado "PULSE" quanto o enum PT-BR "PULSO_ENVIADO"
  if (t === "PULSE" || t === "PULSO_ENVIADO") return "PULSO_ENVIADO";
  if (t === "BUSY_ON") return "BUSY_ON";
  if (t === "BUSY_OFF") return "BUSY_OFF";
  if (t === "HEARTBEAT") return "HEARTBEAT";
  if (t === "ERRO" || t === "ERROR") return "ERRO";

  return "";
}

/**
 * EVENTO (PT-BR)
 * - Auth HMAC via verifyHmac
 * - Registra evento em eventos_iot (PT-BR) ligado a gateway_id e (se possível) maquina_id (condominio_maquinas.id)
 * - Mantém log legado em iot_eventos + iot_ciclos (pra não quebrar nada)
 * - Se vier cmd_id, amarra com iot_commands e atualiza status -> EXECUTADO quando fizer sentido
 * - Atualiza ciclos (PT-BR) quando tiver ciclo_id no payload do comando:
 *    AGUARDANDO_LIBERACAO -> LIBERADO (PULSO)
 *    LIBERADO -> EM_USO (BUSY_ON)
 *    EM_USO -> FINALIZADO (BUSY_OFF)
 *   + timestamps pulso_enviado_at / busy_on_at / busy_off_at (+ eta_livre_at opcional)
 */
export async function POST(req: Request) {
  const serial = (req.headers.get("x-gw-serial") || "").trim();
  const ts = (req.headers.get("x-gw-ts") || "").trim();
  const sign = (req.headers.get("x-gw-sign") || "").trim();

  if (!serial || !ts || !sign) {
    return json(400, { ok: false, error: "headers_missing" });
  }

  const rawBody = await req.text();

  const { ok: hmacOk, debug } = verifyHmac({
    serial,
    ts,
    receivedHex: sign,
    rawBody,
  });

  if (!hmacOk) {
    const debugOn = process.env.DEBUG_HMAC === "1";
    console.log("[IOT_EVENTO] invalid_hmac", {
      serial: debug.serial,
      serialNorm: debug.serialNorm,
      ts: debug.ts,
      rawBodyLen: debug.rawBodyLen,
      secretSource: debug.secretSource,
      expectedHead: debug.expectedHead,
      receivedHead: debug.receivedHead,
      envHasGeneric: debug.envHasGeneric,
      envHasPerSerial: debug.envHasPerSerial,
      baseHead: debug.baseHead,
      rawBodyHead: debug.rawBodyHead,
    });

    return json(401, {
      ok: false,
      error: "invalid_hmac",
      ...(debugOn ? { debug } : {}),
    });
  }

  // JSON válido obrigatório
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const tipoIn = String(payload?.type ?? "");
  const tipo = normalizeTipo(tipoIn);
  if (!tipo) return json(400, { ok: false, error: "missing_or_invalid_type", received: tipoIn });

  const tsGw = toInt(ts, NaN);
  if (!Number.isFinite(tsGw)) return json(400, { ok: false, error: "invalid_ts" });

  const admin = supabaseAdmin() as any;

  // timestamps baseados no ts do gateway (mais correto que now do servidor)
  const eventoIso = new Date(tsGw * 1000).toISOString();

  // 0) Resolve gateway_id pelo serial
  const { data: gw, error: gwErr } = await admin
    .from("gateways")
    .select("id, serial, condominio_id")
    .eq("serial", serial)
    .maybeSingle();

  if (gwErr) {
    return json(500, { ok: false, error: "db_error", detail: gwErr.message });
  }
  if (!gw) {
    return json(404, { ok: false, error: "gateway_not_found" });
  }

  // 1) Resolver máquina (condominio_maquinas.id) por:
  //    a) machine_id (identificador_local), OU
  //    b) cmd_id -> iot_commands.condominio_maquinas_id
  const machineIdent = payload?.machine_id ? String(payload.machine_id).trim() : "";
  const cmdId = payload?.cmd_id ? String(payload.cmd_id).trim() : "";

  let condominioMaquinasId: string | null = null;

  // cmd_id -> iot_commands
  let cmdRow: any = null;
  if (cmdId) {
    const { data: c, error: cErr } = await admin
      .from("iot_commands")
      .select("id, cmd_id, status, tipo, payload, condominio_maquinas_id")
      .eq("gateway_id", gw.id)
      .eq("cmd_id", cmdId)
      .maybeSingle();

    if (cErr) {
      return json(500, { ok: false, error: "db_error", detail: cErr.message });
    }
    cmdRow = c ?? null;
    if (cmdRow?.condominio_maquinas_id) {
      condominioMaquinasId = String(cmdRow.condominio_maquinas_id);
    }
  }

  // machine_id -> condominio_maquinas
  if (!condominioMaquinasId && machineIdent) {
    const { data: m, error: mErr } = await admin
      .from("condominio_maquinas")
      .select("id, identificador_local, gateway_id, condominio_id")
      .eq("gateway_id", gw.id)
      .eq("identificador_local", machineIdent)
      .maybeSingle();

    if (mErr) {
      return json(500, { ok: false, error: "db_error", detail: mErr.message });
    }
    if (m?.id) condominioMaquinasId = String(m.id);
  }

  // 2) Registrar evento PT-BR (eventos_iot)
  const { data: evPt, error: evPtErr } = await admin
    .from("eventos_iot")
    .insert({
      gateway_id: gw.id,
      maquina_id: condominioMaquinasId,
      tipo, // enum iot_evento_tipo
      payload: payload ?? {},
      created_at: eventoIso,
    })
    .select("id, created_at")
    .single();

  if (evPtErr || !evPt) {
    return json(500, {
      ok: false,
      error: "db_error",
      detail: evPtErr?.message ?? "insert_eventos_iot_failed",
    });
  }

  // 3) Manter log legado (iot_eventos) para compatibilidade
  const { data: evLegacy, error: evLegacyErr } = await admin
    .from("iot_eventos")
    .insert({
      gw_serial: serial,
      ts_gw: tsGw,
      tipo, // normalizado
      payload,
      raw_body: rawBody,
      hmac_ok: true,
    })
    .select("id, created_at")
    .single();

  if (evLegacyErr || !evLegacy) {
    // não aborta: PT-BR já foi gravado; só reporta
    return json(200, {
      ok: true,
      evento_id: evPt.id,
      created_at: evPt.created_at,
      warning: "legacy_iot_eventos_insert_failed",
      legacy_detail: evLegacyErr?.message ?? "unknown",
    });
  }

  /**
   * Atualiza ciclos (PT-BR) apenas se houver ciclo_id no payload do comando.
   * Regra: não “adivinha” ciclo por outras tabelas (pra não quebrar).
   */
  const cicloId: string = cmdRow?.payload?.ciclo_id ? String(cmdRow.payload.ciclo_id) : "";

  async function updateCicloSafe(upd: any, whereStatus?: string) {
    if (!cicloId) return { did: false };

    let q = admin.from("ciclos").update(upd).eq("id", cicloId);

    // trava por status quando fizer sentido (evita regressão de estado)
    if (whereStatus) q = q.eq("status", whereStatus);

    const { data, error } = await q.select("id,status").maybeSingle();
    if (error) {
      console.log("[IOT_EVENTO] ciclo_update_error", { cicloId, tipo, error: error.message });
      return { did: false, error: error.message };
    }
    return { did: !!data, data };
  }

  // 4) Se for PULSO_ENVIADO, criar iot_ciclos (legado) + fechar loop do comando/ciclo
  if (tipo === "PULSO_ENVIADO") {
    const pulsesRaw = payload?.payload?.pulses ?? payload?.pulses ?? 1;
    const pulses = toInt(pulsesRaw, 1);

    if (!Number.isFinite(pulses) || pulses <= 0) {
      return json(400, { ok: false, error: "invalid_pulses", evento_id: evPt.id });
    }

    // legado: registra N ciclos
    const rows = Array.from({ length: pulses }, () => ({
      gw_serial: serial,
      ts_gw: tsGw,
      ciclos: 1,
      origem: "PULSE",
      evento_id: evLegacy.id,
    }));

    const { error: cErr } = await admin.from("iot_ciclos").insert(rows);
    if (cErr) {
      return json(500, {
        ok: false,
        error: "db_error",
        detail: cErr.message,
        evento_id: evPt.id,
      });
    }

    // 4.1) Se tiver cmdRow, atualiza iot_commands -> EXECUTADO (só se estava ENVIADO/ACK)
    if (cmdRow?.id) {
      const currStatus = String(cmdRow.status ?? "");
      if (currStatus === "ENVIADO" || currStatus === "ACK") {
        await admin.from("iot_commands").update({ status: "EXECUTADO" }).eq("id", cmdRow.id).eq("gateway_id", gw.id);
      }
    }

    // 4.2) Atualiza ciclo PT-BR: AGUARDANDO_LIBERACAO -> LIBERADO + pulso_enviado_at
    const cicloUpd = await updateCicloSafe(
      {
        pulso_enviado_at: eventoIso,
        status: "LIBERADO",
      },
      "AGUARDANDO_LIBERACAO"
    );

    return json(200, {
      ok: true,
      evento_id: evPt.id,
      created_at: evPt.created_at,
      legacy_evento_id: evLegacy.id,
      ciclos_criados: pulses,
      ciclo_atualizado: cicloUpd.did,
    });
  }

  // BUSY_ON: LIBERADO -> EM_USO + busy_on_at
  if (tipo === "BUSY_ON") {
    const cicloUpd = await updateCicloSafe(
      {
        busy_on_at: eventoIso,
        status: "EM_USO",
        // eta_livre_at: opcional (não temos base confiável aqui)
      },
      "LIBERADO"
    );

    return json(200, {
      ok: true,
      evento_id: evPt.id,
      created_at: evPt.created_at,
      legacy_evento_id: evLegacy.id,
      ciclo_atualizado: cicloUpd.did,
    });
  }

  // BUSY_OFF: EM_USO -> FINALIZADO + busy_off_at
  if (tipo === "BUSY_OFF") {
    const cicloUpd = await updateCicloSafe(
      {
        busy_off_at: eventoIso,
        status: "FINALIZADO",
      },
      "EM_USO"
    );

    return json(200, {
      ok: true,
      evento_id: evPt.id,
      created_at: evPt.created_at,
      legacy_evento_id: evLegacy.id,
      ciclo_atualizado: cicloUpd.did,
    });
  }

  // HEARTBEAT/ERRO: por enquanto só log + ligação PT-BR
  return json(200, {
    ok: true,
    evento_id: evPt.id,
    created_at: evPt.created_at,
    legacy_evento_id: evLegacy.id,
  });
}
