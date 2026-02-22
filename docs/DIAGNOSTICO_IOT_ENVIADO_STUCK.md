# Diagnóstico: comandos ENVIADO presos e ciclos em AGUARDANDO_LIBERACAO

## Causa raiz (hipóteses com evidência no código)

### 1. Poll entrega uma vez e marca ENVIADO; não há reentrega

- **Onde:** `lib/iot/service.ts` → `pollCommands()`.
- **Evidência:** A query busca apenas `status IN ('PENDENTE','pendente','pending')` e `ack_at IS NULL`. Imediatamente após retornar, o backend faz update desses IDs para `status = 'ENVIADO'`. Não existe em lugar nenhum do código um select que devolva comandos **ENVIADO** no poll.
- **Consequência:** Se o gateway pollar com HMAC válido, recebe a lista e os comandos viram ENVIADO. Se o gateway nunca enviar ACK/evento (ou o POST falhar por HMAC, 404, timeout), os comandos ficam **ENVIADO para sempre** e nunca voltam a ser entregues.

### 2. Falta de reconciliação por expires_at

- **Onde:** Nenhum trecho de código atualiza `iot_commands.status` para `EXPIRADO` quando `expires_at < now`.
- **Evidência:** Busca por "EXPIRADO" em `lib/` e `app/api/` mostra uso apenas em `lib/payments/compensation.ts` para **pagamentos**, não para `iot_commands`. Não há job/cron/endpoint que marque comando ENVIADO/PENDENTE expirado → EXPIRADO.
- **Consequência:** Comandos e ciclos permanecem presos; availability continua “reservada” porque o ciclo fica AGUARDANDO_LIBERACAO.

### 3. HMAC ou ambiente no CI (gateway não consegue ACK/evento)

- **Onde:** `lib/iotAuth.ts` (poll/ack) e `lib/iot/service.ts` + `lib/libiot-hmac` (evento).
- **Evidência:** Em produção não há fallback por `gateway_id`; o secret é `IOT_HMAC_SECRET__<SERIAL_NORM>`. Se no Vercel/CI a env estiver ausente ou diferente do usado pelo gateway real, poll pode retornar 500 (missing_secret) ou 401 (invalid_hmac). Para ACK/evento (POST), o body entra no cálculo do HMAC; qualquer diferença invalida a assinatura.
- **Consequência:** O gateway pode estar conseguindo pollar (ex.: secret só para GET em algum cenário) e falhando no POST, ou o gateway real simplesmente não chama ACK/evento (firmware/config). Os 7 comandos em ENVIADO indicam que **algo** chamou poll com sucesso (senão estariam PENDENTE); o mais provável é falha ou ausência de ACK/evento após o poll.

## Onde exatamente o fluxo quebra

| Etapa | Quebra possível | Evidência |
|-------|------------------|-----------|
| Poll entrega | Não quebra; entrega e marca ENVIADO | Comandos no CI estão ENVIADO → poll foi chamado. |
| Poll reentrega | Não existe; ENVIADO nunca volta ao poll | Query só retorna PENDENTE. |
| ACK recebido | Gateway não envia ou POST falha (HMAC/404/500) | ack_at null em todos. |
| Evento recebido | Gateway não envia ou POST falha | Ciclos sem pulso_enviado_at/busy_*; recordEvento não executou. |
| Expiração | Nenhum código marca EXPIRADO | Nenhuma referência a iot_commands + EXPIRADO antes do patch. |

Conclusão: o fluxo quebra **depois do poll** (ACK/evento não aplicados) e **nunca se recupera** porque não havia reconciliação por `expires_at`.

## Patch aplicado

- **Reconciliação:** `reconcileExpiredCommands()` em `lib/iot/service.ts` — marca ENVIADO/PENDENTE com `expires_at < now` como EXPIRADO e aborta o ciclo ligado (ABORTADO).
- **Gatilho:** Executada no início de cada **GET /api/iot/poll** para o tenant.
- **Documentação:** `docs/FLUXO_IOT_MAPA.md`, `docs/RUNBOOK_IOT_RECONCILE.md`.

Validação: ver **RUNBOOK_IOT_RECONCILE.md** (curl/checklist e como reproduzir gateway offline → EXPIRADO + availability liberada).
