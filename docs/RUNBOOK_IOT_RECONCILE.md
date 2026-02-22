# Runbook: reconciliação IoT (ENVIADO/PENDENTE expirado → EXPIRADO)

## Objetivo

Comandos que ficam **ENVIADO** (ou PENDENTE) sem `ack_at` até depois de `expires_at` passam a ser marcados **EXPIRADO** e o ciclo ligado (**AGUARDANDO_LIBERACAO**) passa a **ABORTADO**, liberando a máquina para availability.

## Onde está implementado

- **Função:** `lib/iot/service.ts` → `reconcileExpiredCommands(admin, tenantId, nowIso)`.
- **Gatilho:** Chamada no início de **GET /api/iot/poll** (cada poll do gateway executa a reconciliação para o tenant). Não é necessário cron separado; um único poll de qualquer gateway já “varre” os expirados.

## Comportamento

1. Seleciona até 100 linhas de `iot_commands` com:
   - `tenant_id` = tenant atual
   - `status` IN ('ENVIADO', 'PENDENTE', 'pendente', 'pending')
   - `expires_at` < now (ISO)
2. Para cada linha: atualiza `status` → `EXPIRADO`.
3. Para cada linha: lê `payload.ciclo_id` (ou equivalentes); se existir, atualiza `ciclos` com `id = ciclo_id` e `status = 'AGUARDANDO_LIBERACAO'` → `status = 'ABORTADO'` (idempotente).

## Checklist de validação

### A) Gateway online (fluxo feliz: ENVIADO → ACK → EXECUTADO)

1. Criar pagamento (authorize) e confirmar (confirm).
2. Chamar execute-cycle; obter `command_id` / `cycle_id`.
3. Fazer o gateway (ou fake-gateway) pollar, enviar ACK e eventos (PULSO_ENVIADO, BUSY_ON, BUSY_OFF).
4. **Verificar no DB:** `iot_commands.status` = EXECUTADO (ou ACK + evento aplicado); `ciclos.status` = FINALIZADO; `ciclos.pulso_enviado_at` / `busy_on_at` / `busy_off_at` preenchidos.
5. **curl (após poll):**  
   `GET /api/iot/poll` com HMAC do gateway → deve retornar `commands: []` para esse gateway após o comando ser processado (já não é mais PENDENTE).

### B) Gateway offline (comandos expiram → EXPIRADO + ciclo ABORTADO)

1. Criar pagamento, confirmar, execute-cycle (comando PENDENTE com `expires_at` = now + 5 min).
2. **Não** chamar poll (ou chamar poll com outro gateway que não tenha esse comando).
3. Esperar `expires_at` passar (ex.: 6 minutos) ou, em teste, ajustar `expires_at` no DB para o passado.
4. Chamar **GET /api/iot/poll** com HMAC de **qualquer** gateway do mesmo tenant (pode ser o mesmo gateway que teria o comando).
5. **Verificar no DB:**
   - `iot_commands`: o comando deve ter `status = 'EXPIRADO'`.
   - `ciclos`: o ciclo ligado ao payload desse comando deve ter `status = 'ABORTADO'` (se estava AGUARDANDO_LIBERACAO).
6. **Verificar availability:** POST /api/payments/availability com `condominio_maquinas_id` dessa máquina deve retornar `status: "available"` (não “reserved”).

### C) Curl de exemplo (CI)

Requer HMAC válido (secret no ambiente). Exemplo **poll** (GET):

```bash
# Poll (precisa de x-gw-serial, x-gw-ts, x-gw-sign com HMAC correto)
# Sem secret não é possível gerar assinatura; usar fake-gateway ou script que leia IOT_HMAC_SECRET__GW_LAB_01
ENV=ci node scripts/fake-gateway.mjs
# Em outro terminal, ou após deploy, chamar status:
curl -s "https://ci.metalav.com.br/api/pos/status?pagamento_id=<PAYMENT_ID>"
```

Para **validar reconciliação** sem gateway real:

1. No DB (Supabase): colocar um `iot_command` com `status = 'ENVIADO'`, `ack_at` null, `expires_at` no passado (ex.: `now() - interval '1 minute'`), e um ciclo com `id = payload.ciclo_id` do comando e `status = 'AGUARDANDO_LIBERACAO'`.
2. Chamar **GET /api/iot/poll** com HMAC válido (ex.: rodar fake-gateway uma vez ou usar script que assina).
3. Conferir no DB: comando → EXPIRADO, ciclo → ABORTADO.

## Causa raiz (resumo)

- **Poll** só retorna comandos com status **PENDENTE** e, ao retornar, marca-os como **ENVIADO**. Comandos **ENVIADO** nunca são reentregues.
- Se o gateway recebe a lista (poll ok) mas não envia ACK/evento (rede, HMAC do POST, crash), os comandos ficam **ENVIADO** para sempre e os ciclos em **AGUARDANDO_LIBERACAO**.
- Não havia lógica que marcasse ENVIADO/PENDENTE expirado → **EXPIRADO** nem ciclo → **ABORTADO**. A reconciliação no poll corrige isso e libera a máquina após o TTL (`expires_at`).

## HMAC no CI

- Poll/ACK/evento exigem headers `x-gw-serial`, `x-gw-ts`, `x-gw-sign`.
- Secret: `IOT_HMAC_SECRET__<SERIAL_NORM>` (ex.: GW-LAB-01 → `IOT_HMAC_SECRET__GW_LAB_01`).
- No Vercel/CI, configurar a env com o mesmo valor usado pelo gateway (ou pelo fake-gateway nos testes). Se o secret estiver ausente ou diferente, poll retorna 500 (missing_secret) ou 401 (invalid_hmac) e o gateway não consome comandos.
