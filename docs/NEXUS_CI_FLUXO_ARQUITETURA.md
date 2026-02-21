# Nexus Pagamentos — Panorama arquitetural (ambiente CI)

Objetivo: fluxo exato de estado e dependências entre tabelas para diagnosticar por que pagamentos `CRIADO` não são confirmados pelo `/api/dev/fake-gateway-confirm`.

---

## Fonte da Verdade — fake-gateway-confirm no CI

- **No projeto pagamentos-ci** (deploy em ci.metalav.com.br) **existe** o endpoint **`/api/dev/fake-gateway-confirm`** em `app/api/dev/fake-gateway-confirm/route.ts`.
- O script **fake-gateway** (`scripts/fake-gateway.mjs`) usado no **ambiente CI** depende dessa rota: a cada ciclo do loop ele chama `POST /api/dev/fake-gateway-confirm` com HMAC para simular a confirmação de pagamento (CRIADO → PAGO) e permitir que o fluxo execute-cycle seja executado em seguida.
- **Nota:** Em **production** (`VERCEL_ENV === "production"`) o endpoint **retorna 404** e não processa; só responde em preview/development.

---

## 1. Fluxo exato do authorize

| Aspecto | Detalhe |
|--------|---------|
| **Arquivo** | `app/api/pos/authorize/route.ts` |
| **Método** | `POST` |
| **Entrada** | Header `x-pos-serial`; body: `identificador_local`, `condominio_id` (ou derivado do POS), `valor_centavos`, `metodo` (PIX \| CARTAO). |

### Colunas escritas em `pagamentos` (insert)

| Coluna | Valor | Observação |
|--------|--------|------------|
| `condominio_id` | do body ou do POS | |
| `maquina_id` | `maquina.id` (resolvida por identificador_local + condominio) | |
| `origem` | `"POS"` | |
| `metodo` | `"PIX"` ou `"CARTAO"` | |
| `gateway_pagamento` | `"STONE"` | |
| `valor_centavos` | do body | |
| `idempotency_key` | gerado ou do body | |
| `external_id` | `null` | |
| **`status`** | **`"CRIADO"`** | **Passa a ser definido explicitamente no código** (antes dependia do default do banco). |

### Status inicial

- **Era:** dependia 100% do default da coluna `pagamentos.status` no banco (não há migração no repo que crie `pagamentos`; se o default não for `'CRIADO'`, o fake-gateway-confirm nunca acha o pagamento).
- **Agora:** o insert define `status: "CRIADO"` explicitamente.

### Ciclo no authorize?

- **Não.** O authorize **não cria** linha em `ciclos` nem em `iot_commands`. Comentário no código: “Pagamento (PT-BR) — sem ciclo/comando nesta etapa”.

### Tabelas lidas no authorize (ordem)

1. `pos_devices` (por `x-pos-serial`)
2. `condominio_maquinas` (duplicidade de identificador_local)
3. `condominio_maquinas` (máquina ativa por condominio_id + identificador_local)
4. `pagamentos` (idempotency_key para reuse)
5. `pagamentos` (insert)

---

## 2. Fluxo do `/api/dev/fake-gateway-confirm`

| Aspecto | Detalhe |
|--------|---------|
| **Arquivo** | `app/api/dev/fake-gateway-confirm/route.ts` |
| **Método** | `POST` |
| **Auth** | HMAC (x-gw-serial, x-gw-ts, x-gw-sign). Só responde em ambiente **não-production** (`VERCEL_ENV !== "production"`). |

### Filtros para selecionar pagamentos

| Filtro | Uso | Observação |
|--------|-----|------------|
| **Status** | **Sim.** `.eq("status", "CRIADO")` (exato, case-sensitive). | Se o banco gravar outro valor (ex.: default diferente ou outro case), nenhum registro é retornado. |
| **Origem** | Não. | Não filtra por `origem` (ex.: POS). |
| **gateway_pagamento** | Não. | Não filtra por STONE/ASAAS. |
| **condominio_id** | Não diretamente. | Entra indiretamente: só considera máquinas do gateway; máquinas têm condominio_id. |
| **maquina_id** | **Sim.** Pagamento deve ter `maquina_id` em uma lista: IDs de `condominio_maquinas` onde `gateway_id = <id do gateway do serial>` e `ativa = true`. | Ou seja: só pagamentos cuja máquina pertence ao **mesmo gateway** (por serial) e está ativa. |
| **Janela de tempo** | Não. | Não há filtro por `created_at` ou idade. |
| **external_id** | Não. | Não exige `IS NULL` nem valor específico. |
| **idempotency_key** | Não. | Não filtra por idempotency. |
| **Ignora já existentes?** | Não ignora “já PAGO”: a query só retorna `status = 'CRIADO'`. Pagamentos já PAGO não entram na seleção. | |
| **Update** | Update **direto** em `pagamentos` (sem chamar outro endpoint). | Campos atualizados: `status: "PAGO"`, `paid_at`, `external_id` (fake-gw-uuid), `gateway_pagamento: "STONE"`. |

### Ordem das operações

1. `gateways` por `serial` (do auth).
2. `condominio_maquinas` com `gateway_id = gw.id` e `ativa = true` → lista de `id` (maquina_id).
3. `pagamentos`: um registro com `status = 'CRIADO'` e `maquina_id` nessa lista, ordenado por `created_at` asc, `limit 1`.
4. `pagamentos`: update desse registro para PAGO.

---

## 3. Fluxo de criação de ciclo

| Aspecto | Detalhe |
|--------|---------|
| **Onde é criado** | `app/api/payments/execute-cycle/route.ts` (e indiretamente em `app/api/manual/confirm/route.ts` ao chamar execute-cycle). |
| **Quando** | Só depois que o pagamento está **PAGO**. O execute-cycle exige `pay.status === 'PAGO'`; caso contrário retorna 409 `payment_not_confirmed`. |
| **Status inicial do ciclo** | `"AGUARDANDO_LIBERACAO"`. |
| **Tabela** | `ciclos`. Campos no insert: `pagamento_id`, `condominio_id`, `maquina_id`, `status`. |
| **Dependência** | **Sim:** ciclo **só é criado** se o pagamento estiver PAGO. |

---

## 4. Fluxo de criação de `iot_commands`

| Aspecto | Detalhe |
|--------|---------|
| **Onde** | `app/api/payments/execute-cycle/route.ts` (após criar ou reutilizar ciclo). |
| **Tabela (runtime)** | **`iot_commands`** (nome em inglês; é a tabela canônica do runtime; não há uso de “comandos_iot” ou equivalente PT-BR no fluxo principal). |
| **Quando** | No mesmo request do execute-cycle, depois de garantir ciclo (novo ou existente) e após checagem de idempotência por `execute_idempotency_key` + `ciclo_id` no payload. |
| **Campos obrigatórios no insert** | `gateway_id`, `condominio_maquinas_id`, `pagamento_id`, `cmd_id` (UUID), `tipo` (ex.: "PULSE"), `payload` (JSON com ciclo_id, execute_idempotency_key, etc.), `status: "PENDENTE"`, `expires_at`. |

O poll (fake gateway / IoT) lê em `iot_commands` com `status IN ('PENDENTE','pendente','pending')` e `ack_at IS NULL` (lib/iot/service.ts).

---

## 5. Tabelas legacy (EN) no runtime CI

O script `scripts/anti-legado.js` proíbe referências a:

- `sales`
- `payments`
- `machines`
- `gateway_commands`
- `iot_events`
- `iot_acks_legacy`

**Conclusão:** Nenhum uso dessas tabelas nas rotas em `app/api` foi encontrado. O runtime CI usa apenas tabelas PT-BR/nexus: `pagamentos`, `ciclos`, `condominio_maquinas`, `gateways`, `pos_devices`, `iot_commands`, `eventos_iot`, `iot_eventos` (esta última em lib/iot para legado de eventos). Ou seja, **não há uso de tabelas legacy EN no fluxo de pagamento/execute-cycle/poll no CI**.

---

## 6. Mapa de dependências (estado)

```
[POS] authorize
    → pagamentos (insert: status=CRIADO, maquina_id, condominio_id, ...)
    → não cria ciclos nem iot_commands

[fake-gateway] POST /api/dev/fake-gateway-confirm
    → gateways (por serial)
    → condominio_maquinas (gateway_id, ativa=true) → lista maquina_id
    → pagamentos (status=CRIADO, maquina_id IN lista) → 1 row
    → pagamentos (update → status=PAGO, paid_at, external_id, gateway_pagamento)

[Cliente/Kiosk] POST /api/payments/execute-cycle
    → pagamentos (payment_id) → exige status PAGO
    → condominio_maquinas (id, condominio_id)
    → ciclos (select/insert) → status AGUARDANDO_LIBERACAO
    → iot_commands (insert) → status PENDENTE

[fake-gateway] GET /api/iot/poll
    → iot_commands (gateway_id, status pendente, ack_at null)
    → depois: ack, evento (eventos_iot / iot_eventos)
```

---

## 7. Causas estruturais identificadas

### 7.1 Pagamento permanece CRIADO

- **Causa 1 (corrigida no código):** O authorize **não setava** `status` no insert; o valor vinha só do default do banco. Se o default não fosse exatamente `'CRIADO'`, o fluxo ficava inconsistente e o fake-gateway-confirm não encontrava o pagamento.
  - **Correção:** Insert no authorize passou a definir `status: "CRIADO"` explicitamente.
- **Causa 2:** Máquina do pagamento com `gateway_id` diferente do serial usado pelo fake gateway. O fake-confirm só considera pagamentos cuja `maquina_id` está em `condominio_maquinas` com `gateway_id` do gateway autenticado (x-gw-serial). Se no CI o POS usar uma máquina ligada a outro gateway, o pagamento nunca entra na query do fake-confirm.
- **Causa 3:** Máquina inativa. O fake-confirm usa só `condominio_maquinas.ativa = true`. Se a máquina do pagamento estiver com `ativa = false`, seu `id` não entra na lista e o pagamento CRIADO não é retornado.

### 7.2 fake-confirm não atualiza para PAGO

- **Causa 1:** Nenhum pagamento com `status = 'CRIADO'` (ex.: default do banco diferente ou status nunca setado) → já mitigado com `status: "CRIADO"` no authorize.
- **Causa 2:** Case do status no banco (ex.: `'Criado'`) → `.eq("status", "CRIADO")` não encontra. Com status explícito no app, tende a ficar consistente.
- **Causa 3:** Pagamento com `maquina_id` que não pertence ao gateway do fake (ou máquina inativa) → lista de `maquina_id` não contém o pagamento.
- **Causa 4:** Ambiente `VERCEL_ENV === "production"` → o endpoint retorna 404 e não processa.

### 7.3 Não criação de iot_command

- **Causa 1:** Pagamento não está PAGO → execute-cycle retorna 409. Depende de o fake-confirm (ou outro fluxo) ter marcado o pagamento como PAGO antes.
- **Causa 2:** execute-cycle nunca é chamado (kiosk/CI não chama após o confirm) → ciclo e iot_command não são criados.
- **Causa 3:** Falha na criação do ciclo (ex.: constraint ou erro de banco) → o insert em `iot_commands` não é alcançado.

---

## 8. Checklist de verificação no CI

1. **Banco:** A máquina usada no authorize (identificador_local + condominio) tem `gateway_id` igual ao gateway cujo `serial` é o `GW_SERIAL` do fake gateway?
2. **Banco:** Essa máquina está com `ativa = true`?
3. **Ambiente:** `VERCEL_ENV` não é `production` para o deploy onde o fake-gateway chama (ex.: preview/staging).
4. **Código:** O authorize está com `status: "CRIADO"` no insert (já aplicado neste repo).
5. **Ordem:** O fake gateway está rodando e chamando fake-gateway-confirm **antes** (ou de forma contínua) de alguém chamar execute-cycle; execute-cycle só roda depois que o pagamento está PAGO.

Este documento reflete o estado do código e do fluxo após a correção do `status` no authorize.
