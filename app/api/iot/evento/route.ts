export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function addMinutes(dateIso: string, minutes: number) {
  const d = new Date(dateIso);
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

async function insertEventoFlexible(admin: ReturnType<typeof supabaseAdmin>, row: any) {
  // Alguns bancos podem ter eventos_iot.maquina_id ou eventos_iot.condominio_maquinas_id.
  // Tentamos primeiro "maquina_id" (mais provável pelo seu print de index).
  const first = { ...row, maquina_id: row.maquina_id ?? row.condominio_maquinas_id };
  delete first.condominio_maquinas_id;

  const r1 = await admin.from("eventos_iot").insert(first);
  if (!r1.error) return { ok: true as const };

  // fallback: tenta condominio_maquinas_id
  const second = { ...row, condominio_maquinas_id: row.condominio_maquinas_id ?? row.maquina_id };
  delete second.maquina_id;

  const r2 = await admin.from("eventos_iot").insert(second);
  if (!r2.error) return { ok: true as const };

  return { ok: false as const, error: `Falha ao inserir eventos_iot: ${r1.error.message} | ${r2.error.message}` };
}

export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const auth = await authenticateGateway(req, rawBody);
  if (!auth.ok) return bad(auth.error, auth.status);

  let body: any;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return bad("JSON inválido", 400);
  }
  if (!body) return bad("Body vazio", 400);

  const maquina_id = String(body.maquina_id ?? "");
  const tipo = String(body.tipo ?? "");
  const ts = String(body.ts ?? new Date().toISOString());
  const payload = (body.payload ?? {}) as Record<string, any>;

  if (!maquina_id) return bad("maquina_id obrigatório", 400);
  if (!tipo) return bad("tipo obrigatório", 400);

  const admin = supabaseAdmin();

  // 1) grava evento
  const ins = await insertEventoFlexible(admin, {
    gateway_id: auth.gateway.id,
    maquina_id,
    condominio_maquinas_id: maquina_id,
    tipo,
    payload,
    created_at: ts,
  });

  if (!ins.ok) return bad(ins.error, 500);

  // 2) atualiza estado de busy (se existir config)
  if (tipo === "BUSY_ON" || tipo === "BUSY_OFF") {
    const busy = tipo === "BUSY_ON";

    await admin
      .from("pag_maquina_config")
      .update({ busy_state: busy, busy_updated_at: ts, updated_at: new Date().toISOString() })
      .eq("condominio_maquinas_id", maquina_id);

    // tenta atualizar ciclos também (sem quebrar se não achar)
    if (busy) {
      // pega durações
      const { data: cfg } = await admin
        .from("pag_maquina_config")
        .select("duracao_ciclo_min, buffer_retirada_min")
        .eq("condominio_maquinas_id", maquina_id)
        .maybeSingle();

      const dur = Number(cfg?.duracao_ciclo_min ?? 35);
      const buf = Number(cfg?.buffer_retirada_min ?? 5);
      const eta = addMinutes(ts, dur + buf);

      // atualiza o último ciclo "liberado/aguardando"
      const { data: c } = await admin
        .from("ciclos")
        .select("id, status")
        .eq("condominio_maquinas_id", maquina_id)
        .in("status", ["LIBERADO", "AGUARDANDO_LIBERACAO"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (c?.id) {
        await admin
          .from("ciclos")
          .update({
            status: "EM_USO",
            busy_on_at: ts,
            eta_livre_at: eta,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
      }
    } else {
      // BUSY_OFF: finaliza ciclo em uso
      const { data: c } = await admin
        .from("ciclos")
        .select("id")
        .eq("condominio_maquinas_id", maquina_id)
        .eq("status", "EM_USO")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (c?.id) {
        await admin
          .from("ciclos")
          .update({
            status: "FINALIZADO",
            busy_off_at: ts,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
      }
    }
  }

  // 3) ACK de pulso: marca comando e ciclo
  if (tipo === "PULSO_ENVIADO") {
    const cmdId = String(payload.cmd_id ?? "");
    if (cmdId) {
      // marca comando ACK
      await admin
        .from("iot_commands")
        .update({ status: "ACK", ack_at: new Date().toISOString() })
        .eq("cmd_id", cmdId);

      // marca ciclo como LIBERADO (último da máquina)
      const { data: c } = await admin
        .from("ciclos")
        .select("id, status")
        .eq("condominio_maquinas_id", maquina_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (c?.id && (c.status === "AGUARDANDO_LIBERACAO" || c.status === "LIBERADO")) {
        await admin
          .from("ciclos")
          .update({
            status: "LIBERADO",
            pulso_enviado_at: ts,
            pulso_confirmado: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
