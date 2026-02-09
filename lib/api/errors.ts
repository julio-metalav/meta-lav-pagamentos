import { NextResponse } from "next/server";

export function jsonErrorCompat(
  message: string,
  status = 400,
  options?: { code?: string; retry_after_sec?: number; extra?: Record<string, unknown> }
) {
  const code = options?.code ?? "bad_request";
  return NextResponse.json(
    {
      ok: false,
      // legado (mantém compatibilidade de cliente que lê string)
      error: message,
      // canônico V1
      error_v1: {
        code,
        message,
        ...(typeof options?.retry_after_sec === "number" ? { retry_after_sec: options.retry_after_sec } : {}),
      },
      ...(options?.extra ?? {}),
    },
    { status }
  );
}
