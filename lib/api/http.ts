export function ok(data: unknown, init?: ResponseInit) {
  return Response.json(data, { status: 200, ...(init ?? {}) });
}

export function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...(extra ?? {}) }, { status });
}
