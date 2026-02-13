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
