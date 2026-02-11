import crypto from "crypto";

// Password policy:
// - >= 6 chars
// - at least 1 letter, 1 digit, 1 special
export function validatePassword(pw: string) {
  const s = String(pw || "");
  if (s.length < 6) return { ok: false, reason: "min_length" } as const;
  if (!/[A-Za-z]/.test(s)) return { ok: false, reason: "missing_letter" } as const;
  if (!/[0-9]/.test(s)) return { ok: false, reason: "missing_digit" } as const;
  if (!/[^A-Za-z0-9]/.test(s)) return { ok: false, reason: "missing_special" } as const;
  return { ok: true } as const;
}

// scrypt hash format: scrypt$N$r$p$saltHex$hashHex
export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const keyLen = 64;
  const derived = crypto.scryptSync(pw, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string | null | undefined) {
  if (!stored) return false;
  const parts = String(stored).split("$");
  if (parts.length !== 6) return false;
  const [kind, Ns, rs, ps, saltHex, hashHex] = parts;
  if (kind !== "scrypt") return false;
  const N = Number(Ns);
  const r = Number(rs);
  const p = Number(ps);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(saltHex, "hex");
  const keyLen = Buffer.from(hashHex, "hex").length;
  const derived = crypto.scryptSync(pw, salt, keyLen, { N, r, p });
  return crypto.timingSafeEqual(Buffer.from(hashHex, "hex"), Buffer.from(derived));
}

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function base64UrlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(str: string) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

export function signSession(payload: object, secret: string) {
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64UrlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return { ok: false, reason: "format" } as const;
  const expected = base64UrlEncode(crypto.createHmac("sha256", secret).update(body).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { ok: false, reason: "bad_sig" } as const;
  let json: any = null;
  try {
    json = JSON.parse(base64UrlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_json" } as const;
  }
  return { ok: true, payload: json } as const;
}

export function randomToken() {
  return base64UrlEncode(crypto.randomBytes(32));
}
