# Checklist de validação final — Idempotência POS + RPC atômica

Após rodar as migrações em staging e fazer deploy da branch `fix/pos-idempotency-and-rpc-atomicity`.

---

## Ordem das migrações (Supabase Staging)

Rodar **nessa ordem** no SQL Editor do Supabase (staging):

1. **20260221_authorize_client_request_id.sql**  
   - Adiciona coluna `pagamentos.client_request_id` (text) e comment.  
   - Não cria índice.

2. **20260222_pagamentos_pos_device_id_and_unique.sql**  
   - `DROP INDEX IF EXISTS pagamentos_tenant_client_request_id_key`  
   - `ADD COLUMN pos_device_id`, `ADD COLUMN pos_serial`  
   - Cria 2 índices UNIQUE parciais (tenant+device+client_request_id e tenant+pos_serial+client_request_id).

3. **20260222_rpc_confirm_and_enqueue.sql**  
   - Cria função `rpc_confirm_and_enqueue`.

---

## 1) Idempotência do authorize

- [ ] **1.1** Enviar **2 POST** para `/api/pos/authorize` com **mesmo** `client_request_id`, mesmo `x-pos-serial`, mesmo body (identificador_local, condominio_id, valor_centavos, metodo).
- [ ] **1.2** A **2ª resposta** deve ter `reused: true` e o **mesmo** `pagamento_id` da 1ª.
- [ ] **1.3** No banco, existe **apenas 1** registro em `pagamentos` para esse (tenant_id, pos_device_id, client_request_id).

---

## 2) Fake-gateway e ciclo (IoT)

- [ ] **2.1** Heartbeat: `POST /api/iot/heartbeat` com HMAC → **200**.
- [ ] **2.2** Poll: `GET /api/iot/poll?limit=5` com HMAC → **200** e lista de comandos quando houver.
- [ ] **2.3** Após receber comando: ACK (`POST /api/iot/ack`) e depois **POST /api/iot/evento** com:
  - `type: "PULSO_ENVIADO"` → ciclo deve ir para **LIBERADO**.
  - `type: "BUSY_ON"` → ciclo deve ir para **EM_USO**.
  - `type: "BUSY_OFF"` → ciclo deve ir para **FINALIZADO**.
- [ ] **2.4** `GET /api/pos/status` (com payment_id e headers do POS): deve mostrar ciclo **EM_USO** e depois **FINALIZADO** conforme eventos.

---

## 3) RPC e atomicidade

- [ ] **3.1** Após **confirm** (pagamento PAGO), chamar **POST /api/payments/execute-cycle** com payment_id, condominio_maquinas_id, idempotency_key.
- [ ] **3.2** Resposta **200** com `cycle_id`, `command_id`, `status: "queued"`.
- [ ] **3.3** No banco: existe **1** ciclo e **1** iot_command para esse pagamento; **não** existe pagamento PAGO sem ciclo/iot_command para esse fluxo.
- [ ] **3.4** Chamar **execute-cycle** de novo (mesmo payload): resposta **200** com **replay: true** e **mesmos** cycle_id e command_id; no banco continuam **1** ciclo e **1** iot_command (não duplicados).

---

## 4) Build

- [ ] **4.1** `npm run build` → **verde** (já validado no PR).

---

## Resumo

- Idempotência do authorize: **por (tenant + device + client_request_id)**, não global por tenant.
- RPC garante: **uma transação** para PAGO + ciclo + iot_command; **idempotente** por execute_idempotency_key + ciclo_id.
- Rotas IoT: **POST /api/iot/evento** com `type` PULSO_ENVIADO | BUSY_ON | BUSY_OFF; BUSY_ON → EM_USO, BUSY_OFF → FINALIZADO.
