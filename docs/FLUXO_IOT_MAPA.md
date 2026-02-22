# Mapa do fluxo IoT (NEXUS Pagamentos)

## Visão geral

```
execute-cycle (cria comando PENDENTE)
       ↓
  [Gateway poll]  GET /api/iot/poll  →  backend marca PENDENTE→ENVIADO e retorna lista
       ↓
  [Gateway] envia ACK  POST /api/iot/ack  →  backend grava ack_at, status ACK/FALHOU
       ↓
  [Gateway] envia eventos  POST /api/iot/evento  (PULSO_ENVIADO → BUSY_ON → BUSY_OFF)
       ↓
  recordEvento atualiza ciclo (pulso_enviado_at, busy_on_at, busy_off_at, status) e iot_commands→EXECUTADO
```

---

## 1. Criação / enfileiramento do comando

| Onde | Arquivo | Trecho |
|------|---------|--------|
| **Único ponto de insert** | `app/api/payments/execute-cycle/route.ts` | Após criar/reusar ciclo, `sb.from("iot_commands").insert({ tenant_id, gateway_id, condominio_maquinas_id, pagamento_id, cmd_id, tipo: "PULSE", payload: { ciclo_id, pagamento_id, ... }, status: "PENDENTE", expires_at })` (linhas ~144–162). |

- **Status inicial:** `PENDENTE`
- **expires_at:** `now + 5 min`
- **Filtro de idempotência:** por `execute_idempotency_key` + `ciclo_id` no payload; se já existir comando para essa key+ciclo, retorna replay sem criar outro.

---

## 2. Poll (gateway busca comandos)

| Onde | Arquivo | Função |
|------|---------|--------|
| **Endpoint** | `app/api/iot/poll/route.ts` | `GET` → chama `pollCommands({ req, limit })` |
| **Lógica** | `lib/iot/service.ts` | `pollCommands()` |

**Fluxo em `lib/iot/service.ts` (pollCommands):**

1. **Auth:** `authenticateGateway(req, "")` — GET sem body; usa headers `x-gw-serial`, `x-gw-ts`, `x-gw-sign` (HMAC-SHA256 sobre `serial.ts.rawBody`). Secret: `process.env.IOT_HMAC_SECRET__${SERIAL_NORM}` (ex.: `IOT_HMAC_SECRET__GW_LAB_01`). Em produção, se HMAC falhar → 401; fora de produção permite `gateway_id` na query (sem HMAC).
2. **Resolve gateway:** por `serial` (produção) ou `gateway_id` (dev) em `gateways` com `tenant_id`.
3. **Query comandos:**
   - Tabela: `iot_commands`
   - Filtros: `tenant_id`, `gateway_id`, `status IN ('PENDENTE','pendente','pending')`, `ack_at IS NULL`
   - **Não filtra por `expires_at`** — comandos já expirados ainda são considerados.
   - Ordenação: `created_at` asc, `limit` (1–20).
4. **Imediatamente após:** update em lote: esses mesmos IDs → `status = 'ENVIADO'` (só onde ainda está PENDENTE/pendente/pending). Ou seja: **assim que o poll retorna, os comandos viram ENVIADO e nunca mais entram no poll** (poll só retorna PENDENTE).
5. **last_seen_at:** update em `gateways` (best effort).

**Causa raiz (comandos presos em ENVIADO):** O poll **exclui** ENVIADO. Se o gateway pollar uma vez (HMAC ok), recebe a lista e o backend marca ENVIADO. Se o gateway nunca enviar ACK/evento (falha de rede, HMAC no POST, crash), os comandos ficam **ENVIADO para sempre** e não são reentregues. Não existe hoje nenhum job que marque ENVIADO + `expires_at < now` → EXPIRADO.

---

## 3. ACK (gateway confirma recepção)

| Onde | Arquivo | Função |
|------|---------|--------|
| **Endpoint** | `app/api/iot/ack/route.ts` | `POST` → `ackCommand({ req })` |
| **Lógica** | `lib/iot/service.ts` | `ackCommand()` |

**Fluxo:**

1. **Auth:** `authenticateGateway(req, rawBody)` — POST com body JSON; mesmo esquema HMAC com `rawBody`.
2. **Body:** `cmd_id`, `ok` (boolean), `ts` (unix), opcional `machine_id`, `code`.
3. **Resolve gateway** por `serial` (do HMAC) em `gateways` + `tenant_id`.
4. **Busca comando:** `iot_commands` por `tenant_id`, `gateway_id`, `cmd_id` → `.maybeSingle()`.
5. **Update:** `status = ok ? 'ACK' : 'FALHOU'`, `ack_at = ts` (ISO). Atualiza `gateways.last_seen_at`.

Se o gateway não chamar ACK (ou ACK retornar 401/404/500), o comando permanece ENVIADO e `ack_at` null.

---

## 4. Eventos (PULSO_ENVIADO, BUSY_ON, BUSY_OFF)

| Onde | Arquivo | Função |
|------|---------|--------|
| **Endpoint** | `app/api/iot/evento/route.ts` | `POST` → `recordEvento({ req })` |
| **Lógica** | `lib/iot/service.ts` | `recordEvento()` |

**Auth:** Headers `x-gw-serial`, `x-gw-ts`, `x-gw-sign`; body é o payload do evento. Verificação HMAC via `lib/libiot-hmac` (verifyHmac).

**Fluxo resumido:**

1. Insert em **eventos_iot** (PT-BR, obrigatório).
2. Insert em **iot_eventos** (legado, best-effort).
3. Para PULSO_ENVIADO: opcionalmente atualiza `iot_commands` para `EXECUTADO` (se status ENVIADO/ACK); chama `updateCicloById` + fallback por máquina → ciclo `pulso_enviado_at`, status LIBERADO.
4. Para BUSY_ON: atualiza ciclo → `busy_on_at`, status EM_USO.
5. Para BUSY_OFF: atualiza ciclo → `busy_off_at`, status FINALIZADO.

Se **evento** nunca for chamado (gateway offline ou HMAC/erro), o ciclo fica em AGUARDANDO_LIBERACAO e o comando não vira EXECUTADO.

---

## 5. Autenticação HMAC

| Onde | Arquivo | Detalhe |
|------|---------|--------|
| **Poll / ACK** | `lib/iotAuth.ts` | `authenticateGateway(req, rawBody)`. StringToSign: `${serial}.${ts}.${rawBody}`. Secret: `IOT_HMAC_SECRET__${serial_norm}` (ex.: GW-LAB-01 → `IOT_HMAC_SECRET__GW_LAB_01`). Anti-replay: \|now - ts\| ≤ 600 s. |
| **Evento** | `lib/iot/service.ts` + `lib/libiot-hmac` | `verifyHmac({ serial, ts, receivedHex: sign, rawBody })` (headers x-gw-*). |

Em **CI (produção)** não há fallback por `gateway_id` no poll; HMAC é obrigatório. Se no Vercel/CI a env `IOT_HMAC_SECRET__GW_LAB_01` não estiver definida ou estiver diferente da usada pelo gateway real, poll retorna 500 (missing_secret) ou 401 (invalid_hmac).

---

## 6. Regras de seleção no poll (resumo)

| Regra | Implementado? | Observação |
|-------|----------------|------------|
| Filtro por `gateway_id` | Sim | Via auth (serial → gateway_id) ou query em dev. |
| Status: só PENDENTE | Sim | `.in("status", ["PENDENTE", "pendente", "pending"])` — **ENVIADO nunca é reentregue**. |
| `ack_at` null | Sim | `.is("ack_at", null)`. |
| Ignorar expirados (`expires_at < now`) | **Não** | Comandos PENDENTE expirados ainda são retornados e marcados ENVIADO. |
| Marcar expirados como EXPIRADO | **Não** | Nenhum código atualiza ENVIADO/PENDENTE → EXPIRADO. |
| Filtro `tenant_id` | Sim | Todas as queries usam `tenant_id`. |
| Lock/claim at-least-once | Implícito | Ao retornar, marca ENVIADO; não há reentrega, então “lock” é permanente até ACK/evento ou (a implementar) EXPIRADO. |

---

## 7. Gateways e last_seen

- **Tabela:** `gateways` (id, tenant_id, serial, last_seen_at, ...).
- **Atualização:** No **poll** e no **ACK** (e heartbeat), `last_seen_at` é atualizado (best effort).
- Não há endpoint admin dedicado que liste “últimos polls/acks”; dá para inferir atividade por `gateways.last_seen_at` e por `eventos_iot` / `iot_commands`.

---

## 8. Onde o fluxo quebra (diagnóstico CI)

1. **Poll retorna só PENDENTE; ao retornar vira ENVIADO.** Se o gateway real (GW-LAB-01) pollar com HMAC válido, os 7 comandos teriam virado ENVIADO nesse momento. Como estão todos ENVIADO com `ack_at` null, a explicação mais provável é: **poll foi chamado (HMAC ok), mas ACK e/ou evento nunca foram chamados com sucesso** (gateway não envia, ou POST falha por HMAC/404/500).
2. **Nenhum job marca ENVIADO expirado → EXPIRADO.** Por isso comandos e ciclos ficam presos.
3. **Poll não filtra por `expires_at`.** Comandos já expirados (PENDENTE) podem ser entregues e marcados ENVIADO; o ideal é não entregar e já marcá-los EXPIRADO.

**Patch implementado (fix(iot)):**

- **Reconciliação em `lib/iot/service.ts`:** Função `reconcileExpiredCommands(admin, tenantId, nowIso)` — seleciona `iot_commands` com `status IN ('ENVIADO','PENDENTE',...)` e `expires_at < nowIso`, marca como `EXPIRADO` e, para cada um, atualiza o ciclo `payload.ciclo_id` para `ABORTADO` se ainda estiver `AGUARDANDO_LIBERACAO`. Idempotente.
- **Poll:** No início de `pollCommands`, chama-se `reconcileExpiredCommands` para o tenant; em seguida a query de comandos continua retornando apenas PENDENTE (os já expirados foram marcados EXPIRADO e não aparecem). Assim, qualquer gateway que fizer poll passa a “varrer” comandos expirados e liberar availability.
- Ver **docs/RUNBOOK_IOT_RECONCILE.md** para validação (curl/checklist).
