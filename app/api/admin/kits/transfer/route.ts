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
import { reconcileExpiredCommands } from "@/lib/iot/service";

const CMD_NON_TERMINAL = ["PENDENTE", "pendente", "pending", "ENVIADO"];

export async function POST(req: Request) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const sess = await requireAdminSession();
    if (!sess.ok) return jsonErrorCompat("Unauthorized", 401, { code: "unauthorized" });
    const hasPerm = await requirePermission(sess.user.id, "admin.kits.transfer");
    if (!hasPerm) return jsonErrorCompat("Forbidden", 403, { code: "forbidden" });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pos_device_id = String(body?.pos_device_id ?? "").trim();
    const gateway_id = String(body?.gateway_id ?? "").trim();
    const to_condominio_id = String(body?.to_condominio_id ?? "").trim();
    const reason = body?.reason != null ? String(body.reason).trim() || null : null;
    const auto_reconcile_expired = body?.auto_reconcile_expired === true;

    if (!pos_device_id || !gateway_id || !to_condominio_id) {
      return jsonErrorCompat("pos_device_id, gateway_id e to_condominio_id são obrigatórios.", 400, { code: "missing_params" });
    }

    const admin = supabaseAdmin() as any;

    // 1) POS e Gateway existem e mesmo tenant
    const { data: pos, error: posErr } = await admin
      .from("pos_devices")
      .select("id, condominio_id, serial")
      .eq("tenant_id", tenantId)
      .eq("id", pos_device_id)
      .maybeSingle();
    if (posErr) return jsonErrorCompat("Erro ao validar POS.", 500, { code: "db_error", extra: { details: posErr.message } });
    if (!pos) return jsonErrorCompat("POS não encontrado.", 404, { code: "pos_not_found" });

    const { data: gw, error: gwErr } = await admin
      .from("gateways")
      .select("id, condominio_id, serial")
      .eq("tenant_id", tenantId)
      .eq("id", gateway_id)
      .maybeSingle();
    if (gwErr) return jsonErrorCompat("Erro ao validar gateway.", 500, { code: "db_error", extra: { details: gwErr.message } });
    if (!gw) return jsonErrorCompat("Gateway não encontrado.", 404, { code: "gateway_not_found" });

    const from_condominio_id = pos.condominio_id;
    if (gw.condominio_id !== from_condominio_id) {
      return jsonErrorCompat("Kit não é coeso: POS e Gateway pertencem a condomínios diferentes.", 400, { code: "kit_not_cohesive" });
    }

    if (to_condominio_id === from_condominio_id) {
      return jsonErrorCompat("Condomínio de destino deve ser diferente do atual.", 400, { code: "same_condominio" });
    }

    // 2) Destino existe e mesmo tenant
    const { data: toCond, error: toErr } = await admin
      .from("condominios")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", to_condominio_id)
      .maybeSingle();
    if (toErr) return jsonErrorCompat("Erro ao validar condomínio de destino.", 500, { code: "db_error", extra: { details: toErr.message } });
    if (!toCond) return jsonErrorCompat("Condomínio de destino não encontrado.", 404, { code: "to_condominio_not_found" });

    // 3) BLOQUEIO: kit ainda anexado a máquinas no condomínio de origem
    const { data: attached, error: attErr } = await admin
      .from("condominio_maquinas")
      .select("id, identificador_local")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", from_condominio_id)
      .or(`gateway_id.eq.${gateway_id},pos_device_id.eq.${pos_device_id}`)
      .limit(1);

    if (attErr) return jsonErrorCompat("Erro ao verificar máquinas.", 500, { code: "db_error", extra: { details: attErr.message } });
    if (attached?.length) {
      return jsonErrorCompat(
        "Kit ainda anexado a máquinas no condomínio de origem. Desanexe no passo Máquinas antes de transferir.",
        409,
        { code: "kit_attached_to_machines" }
      );
    }

    // 4) Pendências: comandos não-terminais do gateway
    const { data: cmdRows } = await admin
      .from("iot_commands")
      .select("id, payload, expires_at, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .eq("gateway_id", gateway_id)
      .in("status", CMD_NON_TERMINAL)
      .limit(200);

    let hasActiveCommand = false;
    let hasExpiredCommand = false;
    for (const row of cmdRows || []) {
      const cmdRow: CommandRow = { id: row.id, expires_at: row.expires_at, created_at: row.created_at, updated_at: row.updated_at, payload: row.payload };
      if (isCommandExpired(cmdRow)) hasExpiredCommand = true;
      else hasActiveCommand = true;
    }
    if (hasActiveCommand) {
      return jsonErrorCompat("Pendência ativa: comando dentro do TTL. Aguarde ou cancele antes de transferir.", 409, { code: "pending_active_command" });
    }
    if (hasExpiredCommand && !auto_reconcile_expired) {
      return jsonErrorCompat(
        "Pendência vencida (comando expirado). Rode reconcile ou use auto_reconcile_expired: true.",
        409,
        { code: "pending_expired_command" }
      );
    }

    // 5) Pendências: ciclos pré-uso e EM_USO (maquinas do condomínio de origem que usam este kit)
    const { data: maquinas } = await admin
      .from("condominio_maquinas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", from_condominio_id)
      .or(`gateway_id.eq.${gateway_id},pos_device_id.eq.${pos_device_id}`);

    const maquinaIds = (maquinas || []).map((m: { id: string }) => m.id).filter(Boolean);
    let hasActiveCycle = false;
    let hasExpiredCycle = false;
    if (maquinaIds.length > 0) {
      const { data: cycleRows } = await admin
        .from("ciclos")
        .select("id, status, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .in("maquina_id", maquinaIds)
        .in("status", [...CICLO_STATUS_PRE_USO, CICLO_STATUS_EM_USO])
        .limit(200);

      for (const c of cycleRows || []) {
        const cycleRow: CycleRow = { id: c.id, status: c.status, created_at: c.created_at, updated_at: c.updated_at };
        if (c.status === CICLO_STATUS_EM_USO) {
          return jsonErrorCompat("Ciclo EM_USO ativo. Aguarde finalização (BUSY_OFF) antes de transferir.", 409, { code: "pending_cycle_em_uso" });
        }
        if (isCyclePreUseExpired(cycleRow)) hasExpiredCycle = true;
        else hasActiveCycle = true;
      }
    }
    if (hasActiveCycle) {
      return jsonErrorCompat("Pendência ativa: ciclo pré-uso dentro do TTL. Aguarde ou reconcilie antes de transferir.", 409, {
        code: "pending_active_cycle",
      });
    }
    if (hasExpiredCycle && !auto_reconcile_expired) {
      return jsonErrorCompat("Pendência vencida (ciclo pré-uso expirado). Rode reconcile ou use auto_reconcile_expired: true.", 409, {
        code: "pending_expired_cycle",
      });
    }

    // Auto-reconcile: executar lógica de reconcile para este gateway (comandos + ciclos pré-uso vencidos)
    if (auto_reconcile_expired) {
      const nowIso = new Date().toISOString();
      await reconcileExpiredCommands(admin, tenantId, nowIso);
      // Re-checar se ainda há comandos não-terminal para este gateway (após reconcile)
      const { data: afterCmd } = await admin
        .from("iot_commands")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("gateway_id", gateway_id)
        .in("status", CMD_NON_TERMINAL)
        .limit(1);
      if (afterCmd?.length) {
        return jsonErrorCompat("Ainda há pendência ativa após reconcile. Aguarde ou tente novamente.", 409, { code: "pending_after_reconcile" });
      }
    }

    // Transação lógica: update pos_devices + gateways + insert kit_transfers
    const { error: upPosErr } = await admin.from("pos_devices").update({ condominio_id: to_condominio_id }).eq("tenant_id", tenantId).eq("id", pos_device_id);
    if (upPosErr) return jsonErrorCompat("Erro ao atualizar POS.", 500, { code: "db_error", extra: { details: upPosErr.message } });

    const { error: upGwErr } = await admin.from("gateways").update({ condominio_id: to_condominio_id }).eq("tenant_id", tenantId).eq("id", gateway_id);
    if (upGwErr) {
      await admin.from("pos_devices").update({ condominio_id: from_condominio_id }).eq("tenant_id", tenantId).eq("id", pos_device_id);
      return jsonErrorCompat("Erro ao atualizar gateway.", 500, { code: "db_error", extra: { details: upGwErr.message } });
    }

    const adminSubject = (sess.user as { email?: string }).email ?? sess.user.id ?? null;
    const { data: transferRow, error: trErr } = await admin
      .from("kit_transfers")
      .insert({
        tenant_id: tenantId,
        admin_subject: adminSubject,
        from_condominio_id,
        to_condominio_id,
        pos_device_id,
        gateway_id,
        reason,
        metadata: {
          pos_serial: pos.serial,
          gateway_serial: gw.serial,
          auto_reconcile_expired,
        },
      })
      .select("id")
      .single();

    if (trErr) return jsonErrorCompat("Erro ao registrar log de transferência.", 500, { code: "db_error", extra: { details: trErr.message } });

    return NextResponse.json({ ok: true, transfer_id: transferRow?.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorCompat("Erro inesperado ao transferir kit.", 500, { code: "internal_error", extra: { details: msg } });
  }
}
