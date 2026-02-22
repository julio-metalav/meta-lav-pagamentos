# FASE 2 — Atomicidade PAGO + ciclo + outbox

## Fluxo real (implementado)

1. **authorize** (`/api/pos/authorize`): cria pagamento (status CRIADO). Idempotente por `(tenant_id, pos_device_id, client_request_id)` — não global por tenant.
2. **confirm** (`/api/payments/confirm`): marca pagamento como PAGO (e external_id, paid_at). Idempotente por provider_ref.
3. **execute-cycle** (`/api/payments/execute-cycle`): chama a RPC `rpc_confirm_and_enqueue`, que numa **única transação**:
   - Garante pagamento PAGO (ou retorna erro se ainda não confirmado)
   - Cria ou reutiliza ciclo (por pagamento_id + maquina_id)
   - Cria ou reutiliza iot_command (por execute_idempotency_key + ciclo_id no payload)
   - Retorna ciclo_id, command_id e `already_processed` (replay idempotente)

Assim não existe estado “pagamento PAGO sem ciclo/iot_command” **após** a chamada bem-sucedida ao execute-cycle: a RPC cria os dois na mesma transação.

## RPC

- **Nome:** `rpc_confirm_and_enqueue`
- **Arquivo:** `db/migrations/20260222_rpc_confirm_and_enqueue.sql`
- **Comportamento:** advisory lock por `provider_ref` (se informado) ou `payment_id`; reutiliza ciclo e iot_command quando já existem (idempotente).
- **Idempotência:** chamar execute-cycle duas vezes para o mesmo pagamento/máquina/idempotency_key retorna o mesmo ciclo e command_id, com `already_processed: true` na segunda vez.

## Alternativa futura (confirm estendido)

Se o cliente enviar no **confirm** os dados da máquina (condominio_maquinas_id, idempotency_key) e provider_ref/result, o confirm poderia chamar `rpc_confirm_and_enqueue` com `p_provider_ref` e `p_result`, realizando “confirm + enqueue” numa única chamada. Não implementado nesta entrega.

## Rotas IoT

- **Evento:** `POST /api/iot/evento` — body com `type`: `PULSO_ENVIADO` | `BUSY_ON` | `BUSY_OFF` (e `cmd_id`, `machine_id`, `ts`). BUSY_ON transiciona ciclo LIBERADO → EM_USO; BUSY_OFF transiciona EM_USO → FINALIZADO.
- **Fake-gateway** (`scripts/fake-gateway.mjs`): usa `/api/iot/evento` e envia eventos com `type: "BUSY_ON"` e `type: "BUSY_OFF"` no shape esperado pelo backend.
