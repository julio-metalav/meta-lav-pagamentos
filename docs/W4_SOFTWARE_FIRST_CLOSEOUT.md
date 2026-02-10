# W4 — Software-First Closeout (Sem Gateway Físico)

## Objetivo
Fechar o backend de Pagamentos para operação segura sem hardware em campo, mantendo compatibilidade com o fluxo canônico já validado.

## Escopo entregue

### 1) Fluxo canônico (E2E)
- `POST /api/payments/availability`
- `POST /api/payments/price`
- `POST /api/pos/authorize`
- `POST /api/payments/confirm`
- `POST /api/payments/execute-cycle`

### 2) Idempotência
- `confirm`: `provider + provider_ref`
- `execute-cycle`: `cycle + idempotency_key` com replay retornando o mesmo `command_id`

### 3) TTL / stale pending
- Ciclos `AGUARDANDO_LIBERACAO` expiram por TTL (`PAYMENTS_PENDING_TTL_SEC`, default 300s)
- Stale é marcado como `ABORTADO`
- `execute-cycle` tardio retorna `409 cycle_expired` sem gerar comando IoT

### 4) Compensação por não entrega (W4)
- Scanner (`/api/payments/compensation/scan`): marca `PAGO` não entregue como `EXPIRADO`
- Executor (`/api/payments/compensation/execute`): processa `EXPIRADO` para `ESTORNADO`
- Modo:
  - `simulate` (default)
  - `real` com adapter STONE/ASAAS e idempotência de refund

---

## Variáveis de ambiente

### Core
- `PAYMENTS_PENDING_TTL_SEC` (opcional, default `300`)
- `PAYMENTS_DELIVERY_SLA_SEC` (opcional, default `180`)

### Segurança de endpoints de compensação
- `PAYMENTS_COMPENSATION_SECRET` (opcional, recomendado)
  - Header exigido: `x-compensation-secret`

### Modo de compensação
- `PAYMENTS_COMPENSATION_MODE`:
  - `simulate` (seguro)
  - `real` (aciona adapters)

### Adapter STONE (real)
- `STONE_REFUND_URL`
- `STONE_API_KEY`

### Adapter ASAAS (real)
- `ASAAS_REFUND_URL`
- `ASAAS_API_KEY`

---

## Operação diária (sem hardware)

### Scan
```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:3000/api/payments/compensation/scan" -ContentType "application/json" -Body (@{ sla_sec=180; limit=10 } | ConvertTo-Json)
```

### Execute
```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:3000/api/payments/compensation/execute" -ContentType "application/json" -Body (@{ limit=10 } | ConvertTo-Json)
```

---

## Rollout seguro
1. Iniciar em `simulate`
2. Validar `scan`/`execute` por 24h
3. Ativar `real` em piloto (`limit=5`)
4. Escalar gradualmente (`5 -> 20 -> 50`)
5. Se anomalia: voltar para `simulate`

---

## Critério de pronto pré-gateway
- E2E canônico verde
- TTL/stale funcionando
- Compensação scan/execute operacional
- Logs e runbook de incidente definidos
- Rollback simples por env
