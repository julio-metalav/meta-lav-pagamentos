# RUNBOOK — Fake Gateway (EASY Simulator)

Objetivo: simular um gateway físico para fechar o E2E IoT (poll → ack → eventos) sem hardware em campo.

## 1. Pré-requisitos
- `GW_SERIAL` cadastrado na tabela `gateways` do ambiente alvo (ex.: `GW-FAKE-001`).
- O segredo HMAC correspondente (`IOT_HMAC_SECRET__GW_FAKE_001`) definido no ambiente (Supabase/Vercel).
- A API precisa estar acessível (ex.: `https://ci.metalav.com.br`).

## 2. Configuração do `.env`
Crie um arquivo (ou exporte no shell) com os placeholders abaixo:
```
BASE_URL=https://ci.metalav.com.br
GW_SERIAL=GW-FAKE-001
IOT_HMAC_SECRET=***COLE_AQUI_O_SEGREDO***
POLL_INTERVAL_MS=2000
BUSY_ON_MS=7000
LIMIT=5
CHAOS_MODE=off
CHAOS_DROP_ACK_RATE=0.1
CHAOS_DELAY_MS=400
```
> Observação: `CHAOS_MODE=on` ativa falhas controladas (drop de ACK, jitter extra) para testar idempotência.

## 3. Gerando um comando para testar
1. Execute `POST /api/manual/confirm` (staging) com um `ref_externa` único.
2. A resposta deve trazer `status="queued"` + `command_id`. Isso garante que existe um comando pendente no gateway.

## 4. Executando o fake gateway
No diretório do repo:
```
node scripts/fake-gateway.mjs
```
Exemplo de log esperado:
```
[2026-02-14T22:30:00.123Z] step=start cmd=- machine=- status=- info=BASE_URL=https://ci.metalav.com.br GW_SERIAL=GW-FAKE-001 CHAOS_MODE=off
[2026-02-14T22:30:01.456Z] step=ack cmd=7b9c... machine=LAV-FAKE-01 status=200 info=cycle=9f4a...
[2026-02-14T22:30:01.812Z] step=pulse cmd=7b9c... machine=LAV-FAKE-01 status=200 info=cycle=9f4a...
[2026-02-14T22:30:02.100Z] step=busy_on cmd=7b9c... machine=LAV-FAKE-01 status=200 info=cycle=9f4a...
[2026-02-14T22:30:09.350Z] step=busy_off cmd=7b9c... machine=LAV-FAKE-01 status=200 info=cycle=9f4a...
```

## 5. Validação do fluxo completo
1. `/api/manual/confirm` → retorna `status="queued"`, garantindo que o comando foi criado.
2. Fake gateway consome o comando (ver logs acima).
3. No Supabase/Admin, verifique que `iot_commands.status` evoluiu (`ACK` → `EXECUTADO`).
4. `ciclos` deve transicionar `LIBERADO` → `EM_USO` → `FINALIZADO` após BUSY_OFF.
5. Em caso de erro 401/403, confirme `IOT_HMAC_SECRET` e `GW_SERIAL` cadastrados corretamente.
