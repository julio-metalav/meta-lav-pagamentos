# RUNBOOK — E2E App → IoT → Finalização (Meta-Lav Pagamentos / NEXUS)

## 1) Visão Geral do Fluxo

Fluxo completo, ponta a ponta, sem alterar código:

App (iOS/Android) → /api/app/payments/authorize → cria pagamento (origem=APP) → cria ciclo (AGUARDANDO_LIBERACAO) → cria iot_command (PULSE)
→ Gateway executa poll (/api/iot/poll) → comando sai como ENVIADO → ACK assinado (/api/iot/ack) → EVENTO PULSE assinado (/api/iot/evento)
→ EVENTO BUSY_ON assinado → EVENTO BUSY_OFF assinado → ciclo FINALIZADO.

String a assinar (HMAC SHA-256) segue lib/iotAuth.ts:

- StringToSign: `${serial}.${ts}.${rawBody}`
- Headers: x-gw-serial, x-gw-ts, x-gw-sign

## 2) Pré-requisitos

- APP_JWT_SECRET definido em .env.local (>= 32 chars)
- IOT_HMAC_SECRET__GW_TESTE_001 definido em .env.local (ou IOT_HMAC_SECRET global)
- Gateway cadastrado (gateways) e máquina ativa vinculada (condominio_maquinas)
- POS vinculado à máquina quando o fluxo envolver POS (não é obrigatório para o App authorize)
- Servidor rodando e respondendo (ex.: http://127.0.0.1:3000/ → HTTP 200)

## 3) Passo a passo técnico (comandos mascarados)

Base:
- BASE_URL=http://127.0.0.1:3000 (ajuste a porta se necessário)
- Não imprimir segredos. Em HMAC, mascarar x-gw-sign como ***.

A) START (inicia auth do App)

curl -sS -X POST $BASE_URL/api/app/auth/start \
  -H 'Content-Type: application/json' \
  -d '{"telefone":"+5565987654321"}'

Saída esperada (DEV): { ok: true, user_id, dev: true, codigo_mock: "123456" }

B) VERIFY (gera token do App)

curl -sS -X POST $BASE_URL/api/app/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"telefone":"+5565987654321","codigo":"123456"}'

- Guarde o token (não imprima em logs públicos). Nos exemplos abaixo, não exibimos o token.

C) AUTHORIZE (via App)

curl -sS -X POST $BASE_URL/api/app/payments/authorize \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN_12_CHARS+***>' \
  -d '{"condominio_maquinas_id":"<MAQ_ID>","valor_centavos":1600}'

Resposta esperada: { ok: true, pagamento_id, ciclo_id, cmd_id, gateway_id, expires_at }

D) POLL (DEV, sem HMAC) — verificar ENVIADO

curl -sS "$BASE_URL/api/iot/poll?gateway_id=<GATEWAY_ID>&limit=20"

Conferir que o cmd_id aparece na lista e que o status do iot_command vira ENVIADO.

E) ACK (HMAC) — assinado

- Body: { "cmd_id":"<CMD_ID>", "ok":true, "machine_id":"<IDENT_LOCAL>", "ts":<UNIX_TS> }
- Headers: x-gw-serial, x-gw-ts, x-gw-sign (assinado: *** no output)

curl -sS -X POST $BASE_URL/api/iot/ack \
  -H 'Content-Type: application/json' \
  -H 'x-gw-serial: <GW_SERIAL>' \
  -H 'x-gw-ts: <UNIX_TS>' \
  -H 'x-gw-sign: ***' \
  -d '{"cmd_id":"<CMD_ID>","ok":true,"machine_id":"<IDENT_LOCAL>","ts":<UNIX_TS>}'

F) EVENTO PULSE (HMAC) — assinado

- Body: { "type":"PULSE", "cmd_id":"<CMD_ID>", "machine_id":"<IDENT_LOCAL>", "pulses":1, "ts":<UNIX_TS> }

curl -sS -X POST $BASE_URL/api/iot/evento \
  -H 'Content-Type: application/json' \
  -H 'x-gw-serial: <GW_SERIAL>' \
  -H 'x-gw-ts: <UNIX_TS>' \
  -H 'x-gw-sign: ***' \
  -d '{"type":"PULSE","cmd_id":"<CMD_ID>","machine_id":"<IDENT_LOCAL>","pulses":1,"ts":<UNIX_TS>}'

G) EVENTO BUSY_ON (HMAC) — assinado

curl -sS -X POST $BASE_URL/api/iot/evento \
  -H 'Content-Type: application/json' \
  -H 'x-gw-serial: <GW_SERIAL>' \
  -H 'x-gw-ts: <UNIX_TS>' \
  -H 'x-gw-sign: ***' \
  -d '{"type":"BUSY_ON","machine_id":"<IDENT_LOCAL>","ts":<UNIX_TS>}'

H) EVENTO BUSY_OFF (HMAC) — assinado

curl -sS -X POST $BASE_URL/api/iot/evento \
  -H 'Content-Type: application/json' \
  -H 'x-gw-serial: <GW_SERIAL>' \
  -H 'x-gw-ts: <UNIX_TS>' \
  -H 'x-gw-sign: ***' \
  -d '{"type":"BUSY_OFF","machine_id":"<IDENT_LOCAL>","ts":<UNIX_TS>}'

## 4) Validações no Supabase (REST)

- pagamentos (pelo pagamento_id):
  /rest/v1/pagamentos?id=eq.<PAGAMENTO_ID>&select=id,origem,valor_centavos,created_at
  - origem deve ser "APP"

- ciclos (pelo ciclo_id):
  /rest/v1/ciclos?id=eq.<CICLO_ID>&select=id,status,pulso_enviado_at,busy_on_at,busy_off_at
  - após PULSE: status=LIBERADO, pulso_enviado_at!=null
  - após BUSY_ON: status=EM_USO, busy_on_at!=null
  - após BUSY_OFF: status=FINALIZADO, busy_off_at!=null

- iot_commands (pelo cmd_id):
  /rest/v1/iot_commands?cmd_id=eq.<CMD_ID>&select=cmd_id,status,ack_at,created_at,payload
  - pendente → ENVIADO (após poll) → ACK (após ack) → EXECUTADO (após PULSE)
  - payload.channel deve ser "app"
  - payload.origin.user_id deve estar preenchido

## 5) Checklist de Diagnóstico Rápido

- 401 (ack/evento):
  - Provável assinatura incorreta. Confirme:
    - ts no header = ts do body
    - StringToSign: `${serial}.${ts}.${rawBody}` (rawBody idêntico ao enviado)
    - serial correto (x-gw-serial)
    - Segredo (IOT_HMAC_SECRET__<SERIAL> ou IOT_HMAC_SECRET) está presente no .env.local
- Comando não aparece no poll:
  - Verifique gateway_id no poll
  - Verifique se iot_commands.status está "pendente" e ack_at é NULL
- Ciclo não atualiza:
  - Para PULSE via cmd_id, ciclo_update_source deve ser "cmd_id"
  - Para BUSY_ON/BUSY_OFF, pode usar fallback por machine_id (ciclo_update_source: "fallback_machine")

## 6) Conclusão

- Fluxo App → IoT → Finalização validado 100% em ambiente local, sem alterações de código.
- Este runbook documenta o passo a passo, incluindo comandos de teste e validações nas tabelas envolvidas (pagamentos, ciclos, iot_commands).

## ITEM 1 — E2E Staging V2 (Finance + IoT HMAC) — FECHADO (2026-02-14)
- **Sintoma:** Workflow `E2E Staging V2` quebrava logo no `/api/pos/authorize` (500 `Missing env var: SUPABASE_URL`) e, após corrigir, falhava novamente no `/api/iot/poll` com `missing_secret` para o serial GW_TESTE_001.
- **Causa raiz:** o domínio oficial `https://ci.metalav.com.br` estava apontando para o deploy Production sem variáveis Supabase carregadas (somente o Preview tinha env), e não existia a env dinâmica `IOT_HMAC_SECRET__GW_TESTE_001` no runtime.
- **Correções:**
  - Configuradas no projeto Vercel `pagamentos-ci` (All Environments) as envs: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
  - Garantido que `ci.metalav.com.br` aponta para o deployment correto em Production.
  - Criada env `IOT_HMAC_SECRET__GW_TESTE_001=bb582e1167cef34f44fdaaace5a3639f226fa7c23d0a962589a103b8b0faedd7` no mesmo projeto.
- **Validações:**
  - `curl -i https://ci.metalav.com.br/api/pos/authorize` → 400 `pos_serial ausente` (rota viva com env carregado).
  - `curl -i https://ci.metalav.com.br/api/iot/poll` (sem HMAC) → 401 `missing_serial` (sem `missing_secret`).
  - GitHub Actions verdes: runs `22023640931` e `22023652108` do workflow `E2E Staging V2 (Finance + IoT HMAC)` na branch `test/e2e-full-runner`.
- **Para não repetir:** sempre validar se o domínio aponta para o deployment Production correto antes de rodar o E2E e garantir que cada gateway usado pelo CI tenha sua `IOT_HMAC_SECRET__<SERIAL>` definida nas envs de runtime.

## Piloto Stone Offline — /api/manual/confirm
- **Objetivo:** permitir confirmação manual de pagamentos realizados em POS Stone/Pix offline e disparar o fluxo `execute-cycle` padrão sem alterar o core.
- **Endpoint:** `POST /api/manual/confirm` (App Router). Requer header `x-internal-token` igual ao env `INTERNAL_MANUAL_TOKEN`. Se o token não existir no runtime, o endpoint responde 501 para evitar exposição.
- **Payload:**
  ```json
  {
    "pos_serial": "<serial cadastrado em pos_devices>",
    "condominio_maquinas_id": "<uuid>",
    "valor_centavos": 1600,
    "metodo": "STONE_OFFLINE" | "PIX_OFFLINE" | "CARD_OFFLINE",
    "identificador_local": "LAV-01", // opcional (valida contra a máquina)
    "ref_externa": "stone-slip-123", // opcional e usado para idempotência
    "observacao": "opcional"
  }
  ```
- **Fluxo interno:**
  1. Valida POS + máquina (mesma lógica do POS authorize) e garante máquina ativa/gateway vinculado.
  2. Idempotência: reutiliza pagamento se `ref_externa` ou `idempotency_key` (`manual:<pos_serial>:<ref>`) já existir.
  3. Cria/atualiza pagamento com `origem="MANUAL"`, `metodo` conforme informado, `gateway_pagamento` inferido (`STONE`/`PIX`/`MANUAL`) e status `PAGO`.
  4. Chama internamente `POST /api/payments/execute-cycle` reutilizando o serviço atual (sem duplicar lógica) com idempotency key `manual-exec:<ref>`.
  5. Retorna `{ ok, correlation_id, pagamento_id, pagamento_status="PAGO", cycle_id, command_id, status: "queued" }`.
- **Segurança/Env:**
  - `INTERNAL_MANUAL_TOKEN` deve estar definido (Production/Preview). Sem ele, o endpoint fica desabilitado.
  - O CI preenche o token via secret `INTERNAL_MANUAL_TOKEN` para testar o modo `MANUAL_CONFIRM` no script `scripts/e2e-full.mjs` (`MANUAL_CONFIRM=1`).
- **Validações rápidas:**
  - Sem token: `curl -X POST ... -H 'x-internal-token: wrong'` → 401.
  - Com token e POS válido: resposta 200 com command_id e cycle_id.
  - Supabase: `pagamentos` deve registrar `origem=MANUAL`, `gateway_pagamento` coerente e `status=PAGO`.
  - IoT: o comando criado segue o mesmo fluxo (poll → ack → evento) já monitorado pelo E2E.

