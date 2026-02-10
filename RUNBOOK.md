# RUNBOOK.md — Meta-Lav Pagamentos (POS Rollout + Incidente)

## Objetivo
Operar rollout do POS com risco controlado e rollback rápido.

---

## 1) Rollout progressivo (5% -> 25% -> 100%)

### Pré-check (obrigatório)
- Build: OK
- Smoke: OK
- Commit/tag publicados
- Env de produção revisado

### Fase 1 — 5% (canário)
Config:
```env
PAYMENTS_POS_CANARY_MODE=allowlist
PAYMENTS_POS_CANARY_ALLOWLIST=<condominio_uuid_1>
PAYMENTS_POS_CANARY_BLOCKLIST=
```

Ação:
1. Deploy com vars acima
2. Liberar 1 condomínio de baixo risco
3. Monitorar por 30–60 min

Critérios de avanço:
- confirm falha: estável
- execute falha: estável
- duplicidade: 0
- sem alerta crítico novo

### Fase 2 — 25%
Config:
- adicionar mais condomínios no `PAYMENTS_POS_CANARY_ALLOWLIST`

Ação:
1. Redeploy
2. Monitorar por 1–2h

Critérios de avanço:
- mesmos critérios da Fase 1

### Fase 3 — 100%
Opção simples:
```env
PAYMENTS_POS_CANARY_MODE=off
```

(sem bloqueio de canário)

---

## 2) Rollback imediato (1 passo)

### Rollback parcial (recomendado)
```env
PAYMENTS_POS_CANARY_MODE=allowlist
PAYMENTS_POS_CANARY_ALLOWLIST=<somente condominios estáveis>
```

### Corte total dos afetados
```env
PAYMENTS_POS_CANARY_MODE=blocklist
PAYMENTS_POS_CANARY_BLOCKLIST=<uuid1,uuid2,...>
```

Validação pós-rollback:
- authorize nos afetados retorna `canary_not_allowed`
- queda de erro em confirm/execute
- sem novos incidentes de duplicidade

---

## 3) Monitoramento mínimo

### KPIs críticos
- taxa de falha em `confirm`
- taxa de falha em `execute-cycle`
- duplicidade de cobrança (deve ser 0)
- ciclos expirados/backlog (compensation alert)

### Endpoint operacional
- `POST /api/payments/compensation/alert`

---

## 4) Incidentes comuns + resposta

### A) Pagamento confirmado, máquina não liberou
1. Verificar `payment_id`, `execute_key`
2. Reprocessar execução (idempotente)
3. Se falhar repetido: abrir suporte com IDs

### B) Falha em massa após deploy
1. Acionar rollback parcial/total via canário
2. Validar estabilização por 15 min
3. Só então investigar causa raiz

### C) Suspeita de duplicidade
1. Congelar rollout (modo allowlist restrito)
2. Auditar pagamentos por `provider_ref` e `idempotency_key`
3. Confirmar se houve efeito físico duplicado (`iot_commands`/`ciclos`)

---

## 5) Registro obrigatório de operação

Em cada mudança:
- Data/hora
- Quem executou
- Config aplicada (modo + listas)
- KPIs antes/depois
- Decisão (avançar, manter, rollback)
- Evidências (logs/prints/consultas)
