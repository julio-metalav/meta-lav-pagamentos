const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TTL_WAIT_MS = 35_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

(async () => {
  const common = {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    condominio_id: "71be0b9c-dd53-47c0-8d7a-b3a4bf61ef2c",
    condominio_maquinas_id: "2cfc86c1-6a39-409f-bed0-572878aa4a55",
    service_type: "lavadora",
  };

  const price = await post("/api/payments/price", { ...common, context: { coupon_code: null } });
  console.log("[price]", price.status, price.body);
  if (price.status !== 200) return;

  const auth = await post("/api/pos/authorize", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    pos_serial: "POS-01",
    identificador_local: "M-TESTE-LAV-01",
    metodo: "PIX",
    idempotency_key: crypto.randomUUID(),
    quote: price.body.quote,
    metadata: { ttl_test: true },
  });
  console.log("[authorize]", auth.status, auth.body);
  if (auth.status !== 200) return;

  const payment_id = auth.body.pagamento_id;

  const confirm = await post("/api/payments/confirm", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    payment_id,
    provider: "stone",
    provider_ref: `stone_ttl_${crypto.randomUUID()}`,
    result: "approved",
  });
  console.log("[confirm]", confirm.status, confirm.body);
  if (confirm.status !== 200) return;

  console.log(`Aguardando ${TTL_WAIT_MS / 1000}s...`);
  await sleep(TTL_WAIT_MS);

  const lateExec = await post("/api/payments/execute-cycle", {
    channel: "pos",
    origin: { pos_device_id: null, user_id: null },
    idempotency_key: crypto.randomUUID(),
    payment_id,
    condominio_maquinas_id: "2cfc86c1-6a39-409f-bed0-572878aa4a55",
  });
  console.log("[late execute]", lateExec.status, lateExec.body);
})();
