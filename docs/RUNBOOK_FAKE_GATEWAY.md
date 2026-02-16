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

## 6. Validação real (E2E) — 2026-02-15
- Ambiente: `https://ci.metalav.com.br` (projeto `pagamentos-ci`).
- IDs envolvidos:
  - `cmd_id`: `b9778920-ba64-4d10-896d-a70234c3376d`
  - `ciclo_id`: `5dc9b7c5-d0eb-46cc-bc82-514349813ee9`
  - `pagamento_id`: `86dc60d7-d208-4754-b1a6-659637b9e4e6`
- Resultado agregado:
  - `iot_commands.status = EXECUTADO`, `ack_at = 2026-02-15 03:50:44+00`
  - `ciclos.status = FINALIZADO` com `pulso_enviado_at`, `busy_on_at` e `busy_off_at` preenchidos
  - `pagamentos.status = PAGO`
  - `eventos_iot` timeline: `PULSO_ENVIADO → BUSY_ON → BUSY_OFF`
- Fluxo executado:
  1. `POST /api/manual/confirm` retornou `status="queued"` com `command_id` acima.
  2. `node scripts/fake-gateway.mjs` rodando com `GW_SERIAL=GW-FAKE-001` consumiu o comando e enviou `ACK/PULSO/BUSY_ON/BUSY_OFF`.

### Consulta de validação (IoT Command Cycle & Payment Status)
Use no Supabase (ajuste o comando conforme o cliente SQL):
```sql
select
  c.cmd_id,
  c.status as cmd_status,
  c.ack_at,
  c.gateway_id,
  pag.status as pagamento_status,
  pag.id as pagamento_id,
  pag.valor_centavos,
  cic.id as ciclo_id,
  cic.status as ciclo_status,
  cic.pulso_enviado_at,
  cic.busy_on_at,
  cic.busy_off_at,
  json_agg(ev.tipo order by ev.created_at) as eventos
from iot_commands c
left join pagamentos pag on pag.id = (c.payload ->> 'pagamento_id')
left join ciclos cic on cic.id = (c.payload ->> 'ciclo_id')
left join eventos_iot ev on ev.payload ->> 'cmd_id' = c.cmd_id
where c.cmd_id = 'b9778920-ba64-4d10-896d-a70234c3376d'
group by 1,2,3,4,5,6,7,8,9,10,11;
```
Resultado observado (resumo textual):
```
cmd_id = b9778920-ba64-4d10-896d-a70234c3376d
cmd_status = EXECUTADO
ack_at = 2026-02-15 03:50:44+00
pagamento_id = 86dc60d7-d208-4754-b1a6-659637b9e4e6
pagamento_status = PAGO
ciclo_id = 5dc9b7c5-d0eb-46cc-bc82-514349813ee9
ciclo_status = FINALIZADO
pulso_enviado_at / busy_on_at / busy_off_at preenchidos
eventos = ["PULSO_ENVIADO", "BUSY_ON", "BUSY_OFF"]
```

