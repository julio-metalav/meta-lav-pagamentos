export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/iotAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDefaultTenantId } from "@/lib/tenant";

/**
 * Simulação: confirma um pagamento CRIADO para o gateway (marca como PAGO).
 * Usado pelo script fake-gateway.mjs para que, após o POS enviar authorize,
 * o "gateway simulado" confirme o pagamento e o fluxo execute-cycle possa rodar.
 *
 * Requer autenticação HMAC (x-gw-serial, x-gw-ts, x-gw-sign).
 * Só disponível em ambientes não-production (preview/development).
 */
export async function POST(req: Request) {
  const vercelEnv = process.env.VERCEL_ENV ?? "";
const env = (process.env.ENV ?? "").toLowerCase(); // local|ci|prod
const host = (req.headers.get("host") ?? "").toLowerCase();

const allowInCi =
  env === "ci" || host.includes("ci.metalav.com.br");

if (vercelEnv === "production" && !allowInCi) {
  return NextResponse.json(
    { ok: false, error: "fake_gateway_confirm_only_allowed_in_preview" },
    { status: 404 }
  );
}

  const rawBody = await req.text().catch(() => "");
  const auth = authenticateGateway(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, ...(auth.detail ? { detail: auth.detail } : {}) },
      { status: auth.status ?? 401 }
    );
  }

  const tenantId = getDefaultTenantId();
  const sb = supabaseAdmin() as any;

  const { data: gw, error: gwErr } = await sb
    .from("gateways")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("serial", auth.serial)
    .maybeSingle();

  if (gwErr) {
    return NextResponse.json(
      { ok: false, error: "db_error", detail: gwErr.message },
      { status: 500 }
    );
  }
  if (!gw?.id) {
    return NextResponse.json(
      { ok: false, error: "gateway_not_found" },
      { status: 404 }
    );
  }

  const { data: machineIds, error: machErr } = await sb
    .from("condominio_maquinas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("gateway_id", gw.id)
    .eq("ativa", true);

  if (machErr || !machineIds?.length) {
    return NextResponse.json(
      { ok: true, confirmed: false, reason: "no_machines_or_error" },
      { status: 200 }
    );
  }

  const ids = machineIds.map((m: { id: string }) => m.id);

  const { data: pay, error: payErr } = await sb
    .from("pagamentos")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "CRIADO")
    .in("maquina_id", ids)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (payErr || !pay) {
    return NextResponse.json(
      { ok: true, confirmed: false, reason: payErr ? "db_error" : "no_pending" },
      { status: 200 }
    );
  }

  const providerRef = `fake-gw-${crypto.randomUUID()}`;
  const paidAt = new Date().toISOString();

  const { data: updated, error: upErr } = await sb
    .from("pagamentos")
    .update({
      status: "PAGO",
      paid_at: paidAt,
      external_id: providerRef,
      gateway_pagamento: "STONE",
    })
    .eq("tenant_id", tenantId)
    .eq("id", pay.id)
    .select("id, status")
    .maybeSingle();

  if (upErr || !updated) {
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: upErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    confirmed: true,
    payment_id: updated.id,
    status: "PAGO",
    provider_ref: providerRef,
  });
}
