# Fonte da Verdade — Dashboard Nexus (Banco de Dados)

A stack operacional do Dashboard Nexus lê **exclusivamente** as tabelas PT-BR do schema `public` em Supabase. Tudo aqui é determinístico, auditável e com last update confirmado via `docs/_snapshots/DB_SCHEMA_SNAPSHOT.*`.

## Contexto
- Projeto: Pagamentos / IoT Laundry (Meta-Lav)
- Ambientes: `https://ci.metalav.com.br` (staging) e `https://api.metalav.com.br` (prod/
  admin)
- Schema ativo: `public`
- Linguagem canônica: PT-BR
- Tabelas EN = somente legado / leitura

## Tabelas Canônicas (runtime)

### pagamentos
- **Chave**: `id` (uuid)
- **Relacionamentos**:
  - `pagamentos.id` ↔ `ciclos.pagamento_id`
  - `pagamentos.maquina_id` ↔ `condominio_maquinas.id`
- **Campos críticos**: `valor_centavos`, `metodo (pag_metodo)`, `status (pag_status)`, `origem (pag_origem)`, `gateway_pagamento (pag_gateway)`, `paid_at`
- **Semântica**: registro financeiro canônico por ciclo. `status = PAGO` + `paid_at` preenchido = receita reconhecida.

### ciclos
- **Chave**: `id`
- **Relacionamentos**:
  - `ciclos.pagamento_id` ↔ `pagamentos.id`
  - `ciclos.maquina_id` ↔ `condominio_maquinas.id`
  - `ciclos.id` ↔ `iot_commands.payload->>'ciclo_id'` (cast ::uuid)
- **Campos críticos**: `status (ciclo_status)`, `pulso_enviado_at`, `busy_on_at`, `busy_off_at`, `pulso_confirmado`
- **Semântica**: estado operacional do wash cycle. Esperado: `LIBERADO → EM_USO → FINALIZADO` (ou `ABORTADO`).

### iot_commands
- **Chave**: `cmd_id` (uuid público) / `id` (uuid interno)
- **Relacionamentos**:
  - `iot_commands.condominio_maquinas_id` ↔ `condominio_maquinas.id`
  - Payload JSON contém `pagamento_id` e `ciclo_id` (string) -> sempre `::uuid`
  - `iot_commands.cmd_id` ↔ `eventos_iot.payload->>'cmd_id'`
- **Campos críticos**: `status`, `ack_at`, `expires_at`, `payload`
- **Semântica**: fila de liberação. Status esperado: `PENDING → ACKED → EXECUTADO`; qualquer coisa fora disso entra em alerta do dashboard.

### eventos_iot
- **Chave**: `id`
- **Relacionamentos**:
  - `eventos_iot.gateway_id` ↔ `gateways.id`
  - `eventos_iot.maquina_id` ↔ `condominio_maquinas.id`
  - `eventos_iot.payload->>'cmd_id'` ↔ `iot_commands.cmd_id`
- **Campos críticos**: `tipo (iot_evento_tipo)`, `payload`, `created_at`
- **Semântica**: timeline BUSY/PULSE. O dashboard usa `json_agg(tipo)` para reconstituir a linha do tempo do ciclo.

### gateways
- **Chave**: `id`
- **Relacionamentos**:
  - `gateways.condominio_id` ↔ `condominios.id` (fora do escopo do dashboard, mas obrigatório para filtros)
  - `gateways.id` ↔ `condominio_maquinas.gateway_id`
- **Campos críticos**: `serial`, `last_seen_at`, `busy`, `rssi`
- **Semântica**: disponibilidade física. `last_seen_at` > 5 min dispara alerta e pinta gateway como "offline" na Tela 3.

### pos_devices
- **Chave**: `id`
- **Relacionamentos**:
  - `pos_devices.condominio_id` ↔ `condominios.id`
  - `pos_devices.id` ↔ `condominio_maquinas.pos_device_id`
- **Campos críticos**: `serial`, `last_seen_at`, `stone_merchant_id`
- **Semântica**: mapeia autorizadores POS → máquinas. Usado pelas Telas 1 e 4 para conciliar canal POS.

### condominio_maquinas
- **Chave**: `id`
- **Relacionamentos**:
  - Liga condominio ↔ gateway ↔ POS ↔ máquina
  - `condominio_maquinas.id` ↔ `precos_ciclo.maquina_id`
- **Campos críticos**: `identificador_local`, `tipo (tipo_maquina)`, `duracao_ciclo_min`, `buffer_retirada_min`, `ativa`
- **Semântica**: cadastro mestre das máquinas. Nenhum dashboard consulta máquinas em inglês.

### precos_ciclo
- **Chave**: `id`
- **Relacionamentos**:
  - `precos_ciclo.maquina_id` ↔ `condominio_maquinas.id`
- **Campos críticos**: `valor_centavos`, `vigente_desde`, `vigente_ate`
- **Semântica**: histórico de preço; o dashboard sempre usa o registro com `vigente_desde <= now()` AND (`vigente_ate IS NULL OR > now()`).

## Enums Canônicos
| Enum | Valores |
|---|---|
| `pag_status` | CRIADO, PAGO, CANCELADO, ESTORNADO, EXPIRADO, FALHOU |
| `pag_metodo` | PIX, CARTAO |
| `pag_origem` | POS, APP |
| `pag_gateway` | ASAAS, STONE |
| `ciclo_status` | AGUARDANDO_LIBERACAO, LIBERADO, EM_USO, FINALIZADO, ABORTADO |
| `iot_evento_tipo` | PULSO_ENVIADO, BUSY_ON, BUSY_OFF, HEARTBEAT, ERRO |
| `tipo_maquina` | lavadora, secadora |

Valores EN (ex.: `machine_status`, `sale_status`) são **legado** e não devem entrar em queries do dashboard.

## Relacionamentos-chave para o Dashboard
```
pagamentos (PAGO) --1:1--> ciclos --1:N--> eventos_iot
go via iot_commands (payload.cmd_id, payload.ciclo_id, payload.pagamento_id)
condominio_maquinas --1:1--> gateways | pos_devices | precos_ciclo
```
- Link financeiro: `pagamentos.id = ciclos.pagamento_id`
- Link IoT: `iot_commands.cmd_id = eventos_iot.payload->>'cmd_id'`
- Link preço: `condominio_maquinas.id = precos_ciclo.maquina_id`

## Tabela Legado (read-only)
- `iot_events` (EN): apenas para migrações e comparativos. Qualquer uso runtime precisa ser explicitamente marcado como `read_only` no dashboard e nunca escrever.

## Queries de Referência

### 1) Receita bruta por condomínio/método
```sql
select
  condominio_id,
  metodo,
  gateway_pagamento,
  date_trunc('day', paid_at) as dia,
  count(*) as pagamentos,
  sum(valor_centavos) as valor_total_centavos
from pagamentos
where status = 'PAGO'
  and paid_at >= now() - interval '30 days'
group by 1,2,3,4
order by dia desc;
```

### 2) Fila IoT com ciclo + pagamento
```sql
with cmds as (
  select
    c.cmd_id,
    c.status as cmd_status,
    c.gateway_id,
    c.ack_at,
    (c.payload ->> 'pagamento_id')::uuid as pagamento_id,
    (c.payload ->> 'ciclo_id')::uuid as ciclo_id
  from iot_commands c
  where c.created_at >= now() - interval '2 days'
)
select
  cmds.cmd_id,
  cmds.cmd_status,
  cmds.ack_at,
  pag.status as pagamento_status,
  cic.status as ciclo_status,
  array_agg(ev.tipo order by ev.created_at) as eventos
from cmds
left join pagamentos pag on pag.id = cmds.pagamento_id
left join ciclos cic on cic.id = cmds.ciclo_id
left join eventos_iot ev on ev.payload ->> 'cmd_id' = cmds.cmd_id
where pag.status in ('PAGO', 'CRIADO')
group by 1,2,3,4,5;
```

### 3) Preço vigente por máquina
```sql
select
  cm.id as maquina_id,
  cm.identificador_local,
  cm.tipo,
  pc.valor_centavos,
  pc.vigente_desde,
  pc.vigente_ate
from condominio_maquinas cm
join lateral (
  select *
  from precos_ciclo pc
  where pc.maquina_id = cm.id
    and pc.vigente_desde <= now()
    and (pc.vigente_ate is null or pc.vigente_ate > now())
  order by pc.vigente_desde desc
  limit 1
) pc on true;
```

## Regras de Uso
1. APIs/admins só leem dados destas tabelas.
2. Qualquer coluna nova precisa aparecer primeiro no snapshot (`scripts/db-snapshot.mjs`).
3. Queries do dashboard devem referenciar **apenas** enums/tabelas listados aqui.
4. `iot_commands.status` precisa estar em `('PENDING','ACKED','EXECUTADO')`; outros valores entram em "exceções".
5. `ciclos` e `eventos_iot` são a linha de frente para timeline do Dashboard 2/3.

Mantemos este arquivo como contrato definitivo. Qualquer divergência encontrada via snapshot deve resultar em PR atualizando aqui + YAML. 