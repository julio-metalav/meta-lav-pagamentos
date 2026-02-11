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

---

## 6) Alertas reais (WhatsApp/Email) — Outbox + Dispatcher OpenClaw

### Arquitetura (fonte de verdade)
- O app (Vercel/Next) **não envia** WhatsApp/Email direto.
- O app **enfileira** na tabela Supabase `public.alert_outbox`.
- Um job cron do OpenClaw (dispatcher) lê `alert_outbox` e envia via ferramenta `message.send`.

Tabelas:
- `alert_routes`: roteamento (channel/target/event_code)
- `alert_outbox`: fila de envio
- `alert_dispatch_log`: auditoria de tentativas/envios
- `alert_dlq`: falhas/replay operacional

### IDs / Jobs
- Outbox dispatcher (1 min):
  - jobId: `77e16116-7235-4726-ad53-8adb51b60d77`
  - name: `pagamentos-alerts-outbox-dispatcher-1min`

### Setup (WhatsApp)
1) Linkar a conta WhatsApp no host onde roda o OpenClaw:
```bash
openclaw channels login --channel whatsapp --account default
```

2) Se estiver “linked” mas não enviar, ver status:
```bash
openclaw channels status
```
Esperado: `running, connected`.

3) Se aparecer `stopped/disconnected` ou erro `ETIMEDOUT` (WebSocket 408):
```bash
openclaw gateway restart
openclaw channels status
```

### Setup (Email)
- Requer canal `email` configurado no OpenClaw (SMTP ou provider). Validar com:
```bash
openclaw channels status
```

### Teste operacional (fim-a-fim)
1) Ativar rota no dashboard:
- `https://meta-lav-pagamentos.vercel.app/admin/alert-routes`
- garantir `enabled=true` para a rota do canal/target.

2) Clicar **Testar** na rota.

3) Validar enqueue no Supabase:
```sql
select id, channel, target, status, attempts, last_error, created_at, sent_at
from public.alert_outbox
order by created_at desc
limit 10;
```
Esperado: item novo `pending`.

4) Forçar dispatcher (se não quiser esperar 1 min):
> Nota: nesta versão do OpenClaw, `cron run` usa ID **posicional** (sem `--id`).
```bash
openclaw cron run 77e16116-7235-4726-ad53-8adb51b60d77
```

5) Validar envio:
- `alert_outbox.status = sent` e `sent_at` preenchido.
- mensagem chega no WhatsApp/email.

### Hardening: itens presos em `sending`
- O dispatcher faz requeue automático: se um item ficar `sending` por > 5 min, volta para `failed` com `last_error='sending_timeout'`.
- Override via env (no host OpenClaw):
  - `ALERTS_OUTBOX_SENDING_TIMEOUT_MS=300000`

### Troubleshooting rápido

**Caso 1: outbox cria `pending`, mas não vira `sent`**
- Ver se o cron está ativo:
```bash
openclaw cron list
openclaw cron runs --id 77e16116-7235-4726-ad53-8adb51b60d77
```
- Ver se WhatsApp/email está `running, connected`:
```bash
openclaw channels status
```

**Caso 2: erro “No active WhatsApp Web listener”**
- Rodar login + restart:
```bash
openclaw channels login --channel whatsapp --account default
openclaw gateway restart
openclaw channels status
```

**Caso 3: itens foram para `dead/max_attempts`**
- Não serão mais processados (o scan só pega `pending/failed`). Gere novo teste ou reset manual (com cuidado).

---

## 7) Nomenclatura UI (padrão)

Para evitar regressões de linguagem no produto:
- **UI:** usar **Loja/Lojas**
- **Interno técnico:** manter `condominio_id` e estruturas existentes

Referência oficial:
- `docs/ui-terms.md`

---

## 8) Perfis prontos de permissão (Admin · Usuários)

Tela: `/admin/users` (seção Permissões)

Perfis disponíveis com 1 clique:

### Perfil: Leitura
- Seleciona apenas permissões `*.read` + `dashboard.read`
- Uso recomendado: auditoria, consulta, acompanhamento sem ação operacional

### Perfil: Operação
- Inclui:
  - `dashboard.read`
  - tudo de `alerts.*`
  - `admin.users.read`
  - leitura/escrita de:
    - `admin.gateways.*`
    - `admin.pos_devices.*`
    - `admin.maquinas.*`
    - `admin.condominios.*`
- Uso recomendado: time operacional diário
- Não inclui gestão completa de usuários (`admin.users.write`)

### Perfil: Gestor
- Seleciona todas as permissões disponíveis
- Uso recomendado: responsáveis com poder de delegação e administração total

### Regra de uso
- Começar pelo menor privilégio necessário (Leitura/Operação)
- Escalar para Gestor apenas quando realmente necessário
- Revisar permissões periodicamente (mínimo mensal)
