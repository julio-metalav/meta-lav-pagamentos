export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonErrorCompat } from "@/lib/api/errors";
import { getTenantIdFromRequest } from "@/lib/tenant";
import { requireAdminSession, requirePermission } from "@/lib/admin/server";
import {
  CICLO_STATUS_PRE_USO,
  CICLO_STATUS_EM_USO,
  isCommandExpired,
  isCyclePreUseExpired,
  type CommandRow,
  type CycleRow,
} from "@/lib/admin/kitTTL";

const CMD_NON_TERMINAL = ["PENDENTE", "pendente", "pending", "ENVIADO"];

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.kits.reconcile");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const condominio_id = String(body?.condominio_id ?? "").trim();
    const pos_device_id = String(body?.pos_device_id ?? "").trim();
    const gateway_id = String(body?.gateway_id ?? "").trim();
    const reason = body?.reason != null ? String(body.reason).trim() || null : null;

    if (!condominio_id || !pos_device_id || !gateway_id) {
      return jsonErrorCompat("condominio_id, pos_device_id e gateway_id são obrigatórios.", 400, {
        code: "missing_params",
      });
    }

    const admin = supabaseAdmin() as any;

    // Validar condomínio
    const { data: cond, error: condErr } = await admin
      .from("condominios")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", condominio_id)
      .maybeSingle();
    if (condErr) return jsonErrorCompat("Erro ao validar condomínio.", 500, { code: "db_error", extra: { details: condErr.message } });
    if (!cond) return jsonErrorCompat("Condomínio não encontrado.", 404, { code: "condominio_not_found" });

    // Validar POS e Gateway no mesmo tenant e mesmo condomínio (kit coeso)
    const { data: pos, error: posErr } = await admin
      .from("pos_devices")
      .select("id, condominio_id")
      .eq("tenant_id", tenantId)
      .eq("id", pos_device_id)
      .maybeSingle();
    if (posErr) return jsonErrorCompat("Erro ao validar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!pos) return jsonErrorCompat("POS não encontrado.", 404, { code: "pos_not_found" });
    if (pos.condominio_id !== condominio_id) {
      return jsonErrorCompat("POS não pertence ao condomínio informado.", 400, { code: "kit_not_cohesive" });
    }

    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, condominio_id")
      .eq("tenant_id", tenantId)
      .eq("id", gateway_id)
      .maybeSingle();
    if (gwErr) return jsonErrorCompat("Erro ao validar gateway.", 500, { code: "db_error", extra: { details: gwErr.message } });
    if (!gw) return jsonErrorCompat("Gateway não encontrado.", 404, { code: "gateway_not_found" });
    if (gw.condominio_id !== condominio_id) {
      return jsonErrorCompat("Gateway não pertence ao condomínio informado.", 400, { code: "kit_not_cohesive" });
    }

    const notes: string[] = [];

    // 1) Comandos do gateway não-terminais: expirados por TTL → EXPIRADO
    const { data: cmdRows, error: cmdSelErr } = await admin
      .from("iot_commands")
      .select("id, payload, expires_at, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .eq("gateway_id", gateway_id)
      .in("status", CMD_NON_TERMINAL)
      .limit(200);

    if (cmdSelErr) return jsonErrorCompat("Erro ao listar comandos.", 500, { code: "db_error", extra: { details: cmdSelErr.message } });

    let commandsExpired = 0;
    const commandIdsExpired: string[] = [];
    for (const row of cmdRows || []) {
      const cmdRow: CommandRow = {
        id: row.id,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        payload: row.payload,
      };
      if (!isCommandExpired(cmdRow)) continue;
      const { error: upErr } = await admin
        .from("iot_commands")
        .update({ status: "EXPIRADO" })
        .eq("tenant_id", tenantId)
        .eq("id", row.id);
      if (!upErr) {
        commandsExpired++;
        commandIdsExpired.push(row.id);
      }
    }

    // Abortar ciclos ligados a esses comandos (AGUARDANDO_LIBERACAO)
    let cyclesAbortedByCmd = 0;
    const cycleIdsAborted: string[] = [];
    for (const row of cmdRows || []) {
      if (!commandIdsExpired.includes(row.id)) continue;
      const payload = (row.payload as Record<string, unknown>) || {};
      const cicloId = (payload.ciclo_id ?? payload.cicloId ?? (payload.ciclo as any)?.id ?? (payload.ciclo as any)?.ciclo_id ?? "") as string;
      if (!cicloId || typeof cicloId !== "string") continue;
      const { data: aborted } = await admin
        .from("ciclos")
        .update({ status: "ABORTADO" })
        .eq("tenant_id", tenantId)
        .eq("id", cicloId)
        .in("status", ["AGUARDANDO_LIBERACAO"])
        .select("id")
        .maybeSingle();
      if (aborted) {
        cyclesAbortedByCmd++;
        cycleIdsAborted.push(cicloId);
      }
    }

    // 2) Ciclos pré-uso vencidos por TTL — maquinas do condomínio que usam este kit
    const { data: maquinas } = await admin
      .from("condominio_maquinas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominio_id)
      .or(`gateway_id.eq.${gateway_id},pos_device_id.eq.${pos_device_id}`);

    const maquinaIds = (maquinas || []).map((m: { id: string }) => m.id).filter(Boolean);
    let cyclesExpired = 0;
    if (maquinaIds.length > 0) {
      const { data: cycleRows, error: cycleErr } = await admin
        .from("ciclos")
        .select("id, status, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .in("maquina_id", maquinaIds)
        .in("status", [...CICLO_STATUS_PRE_USO])
        .limit(200);

      if (!cycleErr && cycleRows?.length) {
        for (const c of cycleRows) {
          const cycleRow: CycleRow = { id: c.id, status: c.status, created_at: c.created_at, updated_at: c.updated_at };
          if (!isCyclePreUseExpired(cycleRow)) continue;
          const { error: uErr } = await admin
            .from("ciclos")
            .update({ status: "ABORTADO" })
            .eq("tenant_id", tenantId)
            .eq("id", c.id)
            .in("status", [...CICLO_STATUS_PRE_USO])
            .select("id")
            .maybeSingle();
          if (!uErr) {
            cyclesExpired++;
            cycleIdsAborted.push(c.id);
          }
        }
      }
    }

    // 3) EM_USO: não terminalizar; indicar se há bloqueio
    let blockedActiveUse = false;
    if (maquinaIds.length > 0) {
      const { data: emUso } = await admin
        .from("ciclos")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("maquina_id", maquinaIds)
        .eq("status", CICLO_STATUS_EM_USO)
        .limit(1);
      blockedActiveUse = (emUso?.length ?? 0) > 0;
      if (blockedActiveUse) notes.push("Existe ciclo EM_USO; não foi terminalizado (aguardar BUSY_OFF).");
    }

    const totalCyclesExpired = cyclesAbortedByCmd + cyclesExpired;

    // Registrar log kit_resets
    const adminSubject = (sess.user as { email?: string }).email ?? sess.user.id ?? null;
    const { data: resetRow, error: resetErr } = await admin
      .from("kit_resets")
      .insert({
        tenant_id: tenantId,
        admin_subject: adminSubject,
        condominio_id,
        pos_device_id,
        gateway_id,
        reason,
        metadata: {
          commands_expired: commandsExpired,
          cycles_expired: totalCyclesExpired,
          command_ids: commandIdsExpired,
          cycle_ids: cycleIdsAborted,
          blocked_active_use: blockedActiveUse,
        },
      })
      .select("id")
      .single();

    if (resetErr) return jsonErrorCompat("Erro ao registrar log de reconcile.", 500, { code: "db_error", extra: { details: resetErr.message } });

    return NextResponse.json({
      ok: true,
      reset_id: resetRow?.id,
      affected: {
        commands_expired: commandsExpired,
        cycles_expired: totalCyclesExpired,
      },
      blocked_active_use: blockedActiveUse,
      notes,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao reconciliar kit.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
