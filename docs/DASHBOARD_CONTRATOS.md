	# Contrato — Dashboard Nexus (Telas 1..5)

Todas as telas leem a fonte única em PT-BR (`pagamentos`, `ciclos`, `iot_commands`, `eventos_iot`, `gateways`, `pos_devices`, `condominio_maquinas`, `precos_ciclo`). Sem API pronta, usamos **SQL direto (admin)** conforme descrito.

---

## Dashboard 0 — Diagnóstico instantâneo
- **Objetivo**: calcular status de cada `iot_command` em tempo real com base nos eventos correlacionados.
- **Regra de correlação**: parar de usar janela temporal; sempre pegar o `cmd_id` direto de `eventos_iot.payload->>'cmd_id'` e fazer join 1:1 com `iot_commands.cmd_id`.
- **Status possíveis**:
  - **OK**: `busy_off_at IS NOT NULL`.
  - **LATENCIA**: `ack_at > expires_at` **e** `busy_on_at IS NOT NULL` (ou existe evento `BUSY_ON`).
  - **FALHA**: `ack_at IS NULL` **e** `expires_at < now()` **e** `busy_on_at IS NULL` (e nenhum evento `BUSY_ON`).
- **Regras adicionais**:
  - Se existe `busy_on_at` **ou** evento `BUSY_ON`, nunca marcar como falha, mesmo que `ack_at > expires_at`.
  - O diagnóstico deve olhar `eventos_iot` para confirmar `BUSY_ON`/`BUSY_OFF` usando `cmd_id` no payload.
## Dashboard 1 — Machines Status (OK)
- **Endpoint**: `GET /api/admin/machines-status?limit=`
- **Retorno**: `{ ok, metrics, rows }`
- **Campos em `rows`**: `identificador_local`, `tipo_maquina`, `last_cycle_status`, `busy_on_at`, `busy_off_at`, `status`, `stale_pending`
- **Status possíveis**: `AVAILABLE`, `PENDING`, `IN_USE`, `ERROR`
- **Regra `stale_pending`**: `true` quando o último ciclo está `PENDING` e `created_at` passou de 20 minutos (TTL = 20m); nesse caso, `status = ERROR`

---

## Dashboard 2 — Receita Bruta e Conversão
- **Objetivo**: dar visão diária/semanal de volume financeiro por condomínio / método / gateway de pagamento.
- **KPIs**:
  - `total_pagamentos`: COUNT(*) com `status='PAGO'`
  - `valor_bruto`: SUM(`valor_centavos`) convertido para BRL
  - `ticket_medio`: AVG(`valor_centavos`)
  - `%PIX vs %Cartão`
- **Filtros**: `condominio_id`, intervalo (`paid_at`), `metodo`, `gateway_pagamento`.
- **Cards/Tabelas**:
  1. Cards topo com KPIs gerais filtrados.
  2. Tabela "Receita por dia" com `dia`, `pagamentos`, `valor_bruto`, `ticket_medio`.
  3. Breakdown por método (`PIX`, `CARTAO`).
- **Query base (SQL)**:
  ```sql
  select
    condominio_id,
    date_trunc('day', paid_at) as dia,
    metodo,
    gateway_pagamento,
    count(*) as total_pagamentos,
    sum(valor_centavos) as valor_bruto_centavos,
    avg(valor_centavos) as ticket_medio_centavos
  from pagamentos
  where status = 'PAGO'
    and paid_at between :inicio and :fim
    and (:condominio_id is null or condominio_id = :condominio_id)
  group by 1,2,3,4
  order by dia desc;
  ```
- **Campos esperados**: `condominio_id`, `dia`, `metodo`, `gateway_pagamento`, `total_pagamentos`, `valor_bruto_centavos`, `ticket_medio_centavos`.
- **Regras de negócio**:
  - Considerar apenas `status='PAGO'`.
  - Quando não existir `paid_at`, o registro não entra na visão.
- **Endpoint**: *SQL direto (admin)*.

---

## Dashboard 3 — Timeline de Ciclos e Status Operacional
- **Objetivo**: visualizar rapidamente o funil `Pagamento → Ciclo → Eventos IoT`.
- **KPIs**:
  - `ciclos_abertos`: `status IN ('AGUARDANDO_LIBERACAO','LIBERADO','EM_USO')`
  - `ciclos_finalizados`: `status='FINALIZADO'`.
  - `%ciclos_sem_busy_on`: ciclos com `pulso_enviado_at` preenchido mas sem `busy_on_at` > 2 min.
- **Filtros**: `condominio_id`, `maquina_id`, janela de `created_at`.
- **Cards/Tabelas**:
  1. Cards com contagens.
  2. Tabela timeline por ciclo (um registro = um ciclo, com badges para eventos IoT).
  3. Heatmap de duração (`busy_off_at - busy_on_at`).
- **Query base**:
  ```sql
  with ciclos_base as (
    select
      c.id,
      c.condominio_id,
      c.maquina_id,
      c.status,
      c.pulso_enviado_at,
      c.busy_on_at,
      c.busy_off_at,
      c.pulso_confirmado,
      c.created_at,
      p.id as pagamento_id,
      p.status as pagamento_status
    from ciclos c
    left join pagamentos p on p.id = c.pagamento_id
    where c.created_at between :inicio and :fim
      and (:condominio_id is null or c.condominio_id = :condominio_id)
  )
  select
    cb.*,
    array_agg(ei.tipo order by ei.created_at) as eventos_iot
  from ciclos_base cb
  left join eventos_iot ei on ei.payload ->> 'cmd_id' = (
    select ic.cmd_id
    from iot_commands ic
    where (ic.payload ->> 'ciclo_id')::uuid = cb.id
    order by ic.created_at desc
    limit 1
  )
  group by cb.id,
           cb.condominio_id,
           cb.maquina_id,
           cb.status,
           cb.pulso_enviado_at,
           cb.busy_on_at,
           cb.busy_off_at,
           cb.pulso_confirmado,
           cb.created_at,
           cb.pagamento_id,
           cb.pagamento_status;
  ```
- **Campos esperados**: `id (ciclo)`, `pagamento_id`, `status`, timestamps, `eventos_iot` (array), `pagamento_status`.
- **Regras**:
  - Ciclo só é considerado finalizado quando `status='FINALIZADO'` **e** `busy_off_at` preenchido.
  - Destaque especial para `pulso_enviado_at` sem `busy_on_at`.
- **Endpoint**: *SQL direto (admin)* (planejar `/api/dashboard/ciclos` futuramente).

---

## Dashboard 4 — Fila IoT e SLA de Comandos
- **Objetivo**: controlar `iot_commands` pendentes, expirados ou sem ACK.
- **KPIs**:
  - `comandos_pendentes`: `status IN ('PENDING','CRIADO')`
  - `comandos_sem_ack`: `ack_at IS NULL` com `created_at > 90s`
  - `%execucao`: `EXECUTADO / total`
- **Filtros**: `gateway_id`, `condominio_id`, intervalo `created_at`.
- **Cards/Tabelas**:
  1. Cards com contagens.
  2. Tabela de fila (cmd_id, gateway, máquina, status, ETA expiração).
  3. Lista de exceções (`expires_at < now()` ou `status NOT IN ('ACKED','EXECUTADO')`).
- **Query base**:
  ```sql
  with cmds as (
    select
      c.cmd_id,
      c.status,
      c.gateway_id,
      c.condominio_maquinas_id,
      c.ack_at,
      c.expires_at,
      (c.payload ->> 'pagamento_id')::uuid as pagamento_id,
      (c.payload ->> 'ciclo_id')::uuid as ciclo_id,
      c.created_at
    from iot_commands c
    where c.created_at between :inicio and :fim
      and (:gateway_id is null or c.gateway_id = :gateway_id)
  )
  select
    cmds.*,
    pag.status as pagamento_status,
    cic.status as ciclo_status,
    array_agg(ei.tipo order by ei.created_at) as eventos
  from cmds
  left join pagamentos pag on pag.id = cmds.pagamento_id
  left join ciclos cic on cic.id = cmds.ciclo_id
  left join eventos_iot ei on ei.payload ->> 'cmd_id' = cmds.cmd_id
  group by cmds.cmd_id,
           cmds.status,
           cmds.gateway_id,
           cmds.condominio_maquinas_id,
           cmds.ack_at,
           cmds.expires_at,
           cmds.pagamento_id,
           cmds.ciclo_id,
           cmds.created_at,
           pag.status,
           cic.status;
  ```
- **Campos**: `cmd_id`, `status`, `gateway_id`, `ack_at`, `expires_at`, `pagamento_status`, `ciclo_status`, `eventos` array.
- **Regras**:
  - `ACK` esperado <= 5s após criação.
  - `status` aceitos: `PENDING`, `ACKED`, `EXECUTADO`. Qualquer outro aparece como "Exceção".
  - `expires_at < now()` -> linha em vermelho.
- **Endpoint**: *SQL direto (admin)*.

---

## Dashboard 5 — Saúde de Gateways + POS
- **Objetivo**: acompanhar hardware (`gateways`, `pos_devices`) por condomínio.
- **KPIs**:
  - `gateways_offline`: `now() - last_seen_at > interval '5 minutes'`
  - `gateways_busy`: `busy = true`
  - `pos_sem_ping`: `pos_devices.last_seen_at > 15 min`
- **Filtros**: `condominio_id`, `gateway_id`, `pos_device_id`.
- **Cards/Tabelas**:
  1. Card com contagem offline/online/busy.
  2. Tabela Gateways (serial, condomínio, last_seen_at, rssi, modelo, busy, token set?).
  3. Tabela POS (serial, app_version, last_seen_at, stone_merchant_id).
- **Query base**:
  ```sql
  select
    g.id,
    g.serial,
    g.condominio_id,
    g.last_seen_at,
    g.busy,
    g.rssi,
    g.modelo,
    g.updated_at
  from gateways g
  where (:condominio_id is null or g.condominio_id = :condominio_id);

  select
    p.id,
    p.serial,
    p.condominio_id,
    p.last_seen_at,
    p.app_version,
    p.stone_merchant_id
  from pos_devices p
  where (:condominio_id is null or p.condominio_id = :condominio_id);
  ```
- **Campos**: `serial`, `condominio_id`, `last_seen_at`, `busy`, `rssi`, `pos.last_seen_at`, `app_version`.
- **Regras**:
  - Gateway é considerado offline se `now() - last_seen_at > 5 min`.
  - POS "não confiável" se `last_seen_at` nulo.
- **Endpoint**: *SQL direto (admin)* (projeto `/api/dashboard/hardware` futuro).

---

## Dashboard 6 — Catálogo de Máquinas e Preços
- **Objetivo**: consolidar `condominio_maquinas` + `precos_ciclo` + vinculação POS/Gateway.
- **KPIs**:
  - `maquinas_ativas`: COUNT onde `ativa = true`
  - `%maquinas_sem_preco`: máquinas sem registro vigente em `precos_ciclo`
  - `tempo_medio_ciclo`: AVG(`duracao_ciclo_min`)
- **Filtros**: `condominio_id`, `tipo (lavadora|secadora)`.
- **Cards/Tabelas**:
  1. Card total de máquinas por tipo.
  2. Tabela "Catálogo" com `identificador_local`, `tipo`, `gateway_serial`, `pos_serial`, `valor_centavos`, vigência.
  3. Seção "Alertas" para máquinas sem preço vigente ou sem gateway/POS.
- **Query base**:
  ```sql
  with maquinas as (
    select
      cm.id,
      cm.condominio_id,
      cm.identificador_local,
      cm.tipo,
      cm.ativa,
      cm.gateway_id,
      cm.pos_device_id,
      cm.duracao_ciclo_min,
      cm.buffer_retirada_min
    from condominio_maquinas cm
    where (:condominio_id is null or cm.condominio_id = :condominio_id)
      and (:tipo is null or cm.tipo = :tipo)
  )
  select
    m.*,
    g.serial as gateway_serial,
    p.serial as pos_serial,
    pc.valor_centavos,
    pc.vigente_desde,
    pc.vigente_ate
  from maquinas m
  left join gateways g on g.id = m.gateway_id
  left join pos_devices p on p.id = m.pos_device_id
  left join lateral (
    select *
    from precos_ciclo pc
    where pc.maquina_id = m.id
    order by pc.vigente_desde desc
    limit 1
  ) pc on true;
  ```
- **Campos**: `identificador_local`, `tipo`, `gateway_serial`, `pos_serial`, `valor_centavos`, vigência, `duracao_ciclo_min`.
- **Regras**:
  - Máquina "ativa" exige `gateway_id` e `pos_device_id` não nulos.
  - Preço vigente precisa ter `vigente_desde <= now()` e (`vigente_ate` nulo ou futuro).
- **Endpoint**: *SQL direto (admin)*.

---

### Regras gerais dos Dashboards
1. Sempre usar enums PT-BR listados na fonte da verdade.
2. Tabelas EN aparecem apenas como referência histórica (coluna "legado" quando necessário).
3. Todos os filtros devem ser convertidos para `::uuid` antes de comparar.
4. Colunas de valor financeiro exibidas em BRL (dividir `valor_centavos` por 100 com formatação).
5. KPIs não devem contar registros com `created_at` fora da janela selecionada.
