export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signAppJwt } from "@/lib/app/auth";

function normalizePhone(raw: string): string {
  const s = String(raw || "").replace(/[^0-9+]/g, "").trim();
  if (s.startsWith("+")) return s;
  if (s.length === 11) return "+55" + s;
  return s;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const telefone = String(body?.telefone || "").trim();
    const codigo = String(body?.codigo || "").trim();
    if (!telefone) return NextResponse.json({ ok: false, error: "missing_telefone" }, { status: 400 });
    if (!codigo) return NextResponse.json({ ok: false, error: "missing_codigo" }, { status: 400 });

    const dev = process.env.NODE_ENV !== "production";
    if (dev) {
      if (codigo !== "123456") return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 });
    } else {
      return NextResponse.json({ ok: false, error: "otp_provider_not_configured" }, { status: 503 });
    }

    const telefone_norm = normalizePhone(telefone);
    const sb = supabaseAdmin() as any;

    // Encontra/cria usuário
    const { data: existing } = await sb
      .from("usuarios_app")
      .select("id, telefone")
      .or(`telefone.eq.${telefone},telefone_norm.eq.${telefone_norm}`)
      .maybeSingle();

    let user = existing;
    if (!user?.id) {
      const { data: created, error: cErr } = await sb
        .from("usuarios_app")
        .insert({ telefone, telefone_norm })
        .select("id, telefone")
        .single();
      if (cErr) return NextResponse.json({ ok: false, error: "db_error", detail: cErr.message }, { status: 500 });
      user = created;
    }

    const token = signAppJwt({ sub: user.id, tel: user.telefone, role: "app_user" as any });
    return NextResponse.json({ ok: true, token, user: { id: user.id, telefone: user.telefone } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
