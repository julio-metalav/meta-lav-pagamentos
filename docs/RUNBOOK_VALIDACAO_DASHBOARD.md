# Runbook — Validação do Dashboard Nexus (sem hardware)

Objetivo: garantir que os 5 dashboards estão coerentes usando apenas fluxos manuais (`manual_confirm` + fake gateway) e consultas SQL canônicas.

## 0. Pré-requisitos
- `.env.local` com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SCHEMA=public` (default).
- Ambiente alvo operante (`https://ci.metalav.com.br`).
- Gateway fake cadastrado (`GW-FAKE-001` ou equivalente) + segredo HMAC.
- Views auxiliares existentes: `meta_columns`, `meta_enum_values`.

## 1. Preparar dados manuais
1. Rodar `POST /api/manual/confirm` no ambiente CI com payload mínimo (maquina_id válido, preço vigente). Guardar `command_id` retornado.
2. Confirmar que o pagamento correspondente entrou como `status="CRIADO"` ou `PAGO` em `pagamentos`.

## 2. Fake gateway (simulação sem hardware)
1. Exportar envs:
   ```bash
   export BASE_URL=https://ci.metalav.com.br
   export GW_SERIAL=GW-FAKE-001
   export IOT_HMAC_SECRET=... # segredo do gateway
   ```
2. Executar `node scripts/fake-gateway.mjs`.
3. Esperado na saída: passos `ack`, `pulse`, `busy_on`, `busy_off` com status HTTP 200.

## 3. Checklist de consistência
Após rodar o fake gateway, validar:
- `pagamentos.status = 'PAGO'` e `paid_at` preenchido.
- `ciclos.status = 'FINALIZADO'`, com `pulso_enviado_at`, `busy_on_at`, `busy_off_at` preenchidos.
- `iot_commands.status = 'EXECUTADO'`, `ack_at` preenchido, `expires_at` futuro ou nulo.
- `eventos_iot` com sequência `PULSO_ENVIADO → BUSY_ON → BUSY_OFF` para o `cmd_id`.
- `condominio_maquinas` da máquina usada está `ativa = true` e possui `gateway_id` / `pos_device_id`.

## 4. Query agregada (usa cast ::uuid)
Usar no Supabase SQL Editor ou `psql`:
```sql
select
  c.cmd_id,
  c.status as cmd_status,
  c.ack_at,
  c.gateway_id,
  cm.identificador_local,
  (c.payload ->> 'pagamento_id')::uuid as pagamento_id,
  pag.status as pagamento_status,
  pag.valor_centavos,
  (c.payload ->> 'ciclo_id')::uuid as ciclo_id,
  cic.status as ciclo_status,
  cic.pulso_enviado_at,
  cic.busy_on_at,
  cic.busy_off_at,
  json_agg(ei.tipo order by ei.created_at) as eventos
from iot_commands c
left join pagamentos pag on pag.id = (c.payload ->> 'pagamento_id')::uuid
left join ciclos cic on cic.id = (c.payload ->> 'ciclo_id')::uuid
left join eventos_iot ei on ei.payload ->> 'cmd_id' = c.cmd_id
left join condominio_maquinas cm on cm.id = c.condominio_maquinas_id
where c.cmd_id = :command_id
group by 1,2,3,4,5,6,7,8,9,10,11,12,13;
```
**Exemplo de saída esperada** (valores ilustrativos):
```
cmd_id                  | b9778920-ba64-...
cmp_status              | EXECUTADO
ack_at                  | 2026-02-15 03:50:44+00
pagamento_id            | 86dc60d7-d208-4754-b1a6-659637b9e4e6
pagamento_status        | PAGO
valor_centavos          | 1200
ciclo_id                | 5dc9b7c5-d0eb-46cc-bc82-514349813ee9
ciclo_status            | FINALIZADO
pulso_enviado_at        | 2026-02-15 03:50:30+00
busy_on_at              | 2026-02-15 03:50:33+00
busy_off_at             | 2026-02-15 03:57:40+00
eventos                 | {PULSO_ENVIADO,BUSY_ON,BUSY_OFF}
```

## 5. Validação por dashboard
- **Dash 1 (Receita)**: rodar query de receita (`docs/DASHBOARD_CONTRATOS.md`) e conferir que o pagamento aparece com o mesmo `valor_centavos`.
- **Dash 2 (Timeline)**: verificar que a sequência de eventos do ciclo bate com a query acima.
- **Dash 3 (Fila IoT)**: listar comandos com `created_at >= now() - interval '1 hour'` e confirmar que o `cmd_id` aparece como `EXECUTADO`.
- **Dash 4 (Gateways/POS)**: usar `gateways`/`pos_devices` para conferir `last_seen_at` do gateway fake.
- **Dash 5 (Máquinas/Preços)**: garantir que a máquina utilizada possui preço vigente (`precos_ciclo`).

## 6. Snapshot determinístico
1. Rodar `node scripts/db-snapshot.mjs` (usa apenas leitura). Esperado gerar:
   - `docs/_snapshots/DB_SCHEMA_SNAPSHOT.json`
   - `docs/_snapshots/DB_SCHEMA_SNAPSHOT.md`
2. Se aparecer aviso sobre RPC inexistente, aplicar manualmente `docs/_snapshots/rpc_nexus_db_schema_snapshot.sql` no Supabase e repetir.

## 7. Dicas
- Sempre trabalhar com janela temporal curta (últimas 24h) para evitar ruído.
- Quando em dúvida sobre colunas, abrir `docs/FONTE_DA_VERDADE_NEXUS_DB.md`.
- Não confiar em tabelas EN para validação; use-as apenas como referência histórica.

Fim. 