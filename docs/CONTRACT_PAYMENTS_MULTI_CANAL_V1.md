# CONTRACT_PAYMENTS_MULTI_CANAL_V1

Status: **Canônico (V1)**

## 1) Objetivo
Definir contrato único de pagamentos para múltiplos canais (POS, mobile, web, kiosk), mantendo backend-first e sem acoplamento ao canal.

## 2) Contexto fixo
- Backend: Next.js API-only + Supabase
- Domínio: pagamentos + IoT (ESP32 Gateway)
- Runtime: tabelas PT-BR (`pagamentos`, `ciclos`, `iot_commands`, `eventos_iot`, `condominio_maquinas`, `precos_ciclo`)
- Tabelas EN: legado read-only (proibidas em runtime)
- POS: canal burro (sem regra de preço/liberação)

## 3) Premissa central
**O backend não pode depender do canal.**

Canal entra apenas como metadado:
- `channel`: `pos | mobile | web | kiosk`
- `origin`:
  - POS -> `pos_device_id`
  - App/Web/Kiosk -> `user_id`

> Proibido espalhar `if (channel === 'pos')` no core de domínio.

---

## 4) Fluxo canônico único
1. `availability`
2. `price` (gera quote)
3. `authorize` (idempotente)
4. `confirm` (idempotente)
5. `execute-cycle` (idempotente)

Todos os canais usam exatamente o mesmo fluxo.

---

## 5) Contrato de identidade e origem (request base)
Todos os endpoints do fluxo aceitam:

```json
{
  "channel": "pos|mobile|web|kiosk",
  "origin": {
    "pos_device_id": "uuid|null",
    "user_id": "uuid|null"
  }
}
```

Regra:
- O core não assume qual origem veio preenchida.

---

## 6) Endpoints V1

### 6.1 Availability
`POST /api/payments/availability`

Request:
```json
{
  "channel": "pos",
  "origin": { "pos_device_id": "uuid", "user_id": null },
  "condominio_id": "uuid",
  "condominio_maquinas_id": "uuid",
  "service_type": "lavadora"
}
```

Response (200):
```json
{
  "ok": true,
  "machine": {
    "id": "uuid",
    "status": "available",
    "reserved_until": null
  }
}
```

Erros:
- `409 reserved`
- `410 expired`
- `404 machine_not_found`

---

### 6.2 Price (gera quote)
`POST /api/payments/price`

Request:
```json
{
  "channel": "pos",
  "origin": { "pos_device_id": "uuid", "user_id": null },
  "condominio_id": "uuid",
  "condominio_maquinas_id": "uuid",
  "service_type": "lavadora",
  "context": { "coupon_code": null }
}
```

Response (200):
```json
{
  "ok": true,
  "quote": {
    "quote_id": "uuid",
    "amount": 12.5,
    "currency": "BRL",
    "source": "precos_ciclo",
    "rule_id": "preco:uuid",
    "valid_until": "ISO-8601",
    "pricing_hash": "sha256:..."
  }
}
```

Regras:
- Preço sempre decidido no backend.
- `quote` deve carregar integridade (`pricing_hash`) para validação em `authorize`.

---

### 6.3 Authorize (idempotente)
`POST /api/payments/authorize`

Request:
```json
{
  "channel": "pos",
  "origin": { "pos_device_id": "uuid", "user_id": null },
  "idempotency_key": "uuid",
  "condominio_id": "uuid",
  "condominio_maquinas_id": "uuid",
  "service_type": "lavadora",
  "quote_id": "uuid",
  "payment_method": "pix"
}
```

Response (200):
```json
{
  "ok": true,
  "payment_id": "uuid",
  "status": "authorized",
  "amount": 12.5
}
```

Idempotência:
- chave de dedupe mínima: `idempotency_key + channel + origin + condominio_maquinas_id`

---

### 6.4 Confirm (idempotente por provider_ref)
`POST /api/payments/confirm`

Request:
```json
{
  "channel": "pos",
  "origin": { "pos_device_id": "uuid", "user_id": null },
  "payment_id": "uuid",
  "provider": "stone",
  "provider_ref": "stone_tx_123",
  "result": "approved"
}
```

Response (200):
```json
{
  "ok": true,
  "payment_id": "uuid",
  "status": "confirmed"
}
```

Idempotência:
- dedupe obrigatório por `provider + provider_ref`
- replay não pode duplicar estado nem evento

---

### 6.5 Execute Cycle (idempotente)
`POST /api/payments/execute-cycle`

Request:
```json
{
  "channel": "pos",
  "origin": { "pos_device_id": "uuid", "user_id": null },
  "idempotency_key": "uuid",
  "payment_id": "uuid",
  "condominio_maquinas_id": "uuid"
}
```

Response (200):
```json
{
  "ok": true,
  "cycle_id": "uuid",
  "command_id": "uuid",
  "status": "queued"
}
```

Idempotência:
- reexecução deve retornar mesmo `cycle_id` e `command_id`

---

## 7) Eventos obrigatórios
Eventos mínimos em todas as execuções:
- `payment_authorized`
- `payment_confirmed`
- `cycle_started`
- `cycle_finished`
- `payment_failed`
- `payment_refunded`

Campos mínimos de evento:
- `event_id` (dedupe)
- `event_type`
- `aggregate_id` (`payment_id` ou `cycle_id`)
- `occurred_at`
- `origin/channel`

---

## 8) Padrão de erro canônico
```json
{
  "ok": false,
  "error": {
    "code": "reserved",
    "message": "machine reserved",
    "retry_after_sec": 120
  }
}
```

Status HTTP deve refletir o erro (409, 410, 404, etc).

---

## 9) Regras invioláveis
- Backend funciona sem saber se é POS ou App
- Nenhuma regra de preço no canal
- Nenhuma regra de liberação no canal
- Nenhum uso de tabela EN em runtime
- Tudo relevante vira evento
- Idempotência em `authorize`, `confirm`, `execute-cycle`

---

## 10) Checklist incremental de implementação (sem quebra)

### Fase A — Contrato e validação
- [ ] Criar DTOs de request/response para os 5 endpoints
- [ ] Padronizar enum de `service_type` (`lavadora|secadora`)
- [ ] Implementar padrão de erro canônico em todos endpoints novos

### Fase B — Price/Quote
- [ ] Implementar `POST /api/payments/price`
- [ ] Persistir quote com `valid_until` e `pricing_hash`
- [ ] Validar quote na etapa `authorize`

### Fase C — Authorize/Confirm (idempotência)
- [ ] Implementar `authorize` com chave de idempotência definida
- [ ] Implementar `confirm` com dedupe por `provider+provider_ref`
- [ ] Garantir replay-safe sem duplicar eventos

### Fase D — Execute Cycle
- [ ] Implementar `execute-cycle` idempotente
- [ ] Garantir mesmo `cycle_id`/`command_id` em replay
- [ ] Integrar fila `iot_commands` e estados de `ciclos`

### Fase E — Eventos e observabilidade
- [ ] Emitir eventos obrigatórios com `event_id` dedupe
- [ ] Expor trilha mínima para auditoria e dashboard
- [ ] Criar smoke específico do fluxo completo canônico

### Fase F — Rollout seguro
- [ ] Feature flag para ativar contrato V1 por condomínio/canal
- [ ] Fallback compatível durante transição
- [ ] Documentar migração de clientes POS para V1
