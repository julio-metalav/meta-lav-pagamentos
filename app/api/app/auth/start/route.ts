export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizePhone(raw: string): string {
  const s = String(raw || "").replace(/[^0-9+]/g, "").trim();
  if (s.startsWith("+")) return s;
  // DEV fallback: assume Brazil if no country code
  if (s.length === 11) return "+55" + s;
  return s;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const telefone = String(body?.telefone || "").trim();
    if (!telefone) return NextResponse.json({ ok: false, error: "missing_telefone" }, { status: 400 });

    const telefone_norm = normalizePhone(telefone);

    // Upsert básico do usuário (base mínima), sem exigir nome/agora
    const sb = supabaseAdmin() as any;
    let userId: string | null = null;

    const { data: existing } = await sb
      .from("usuarios_app")
      .select("id")
      .or(`telefone.eq.${telefone},telefone_norm.eq.${telefone_norm}`)
      .maybeSingle();

    if (existing?.id) {
      userId = existing.id;
    } else {
      const { data: created, error: cErr } = await sb
        .from("usuarios_app")
        .insert({ telefone, telefone_norm })
        .select("id")
        .single();
      if (cErr) return NextResponse.json({ ok: false, error: "db_error", detail: cErr.message }, { status: 500 });
      userId = created.id;
    }

    const dev = process.env.NODE_ENV !== "production";
    return NextResponse.json({ ok: true, user_id: userId, dev, ...(dev ? { codigo_mock: "123456" } : {}) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
