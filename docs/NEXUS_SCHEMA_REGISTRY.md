# Nexus Schema Registry

Registro comparativo de tabelas: **canônico** (`docs/db-schema.yml`), **snapshot CI** (`docs/_snapshots/*`) e **uso no código** (backend `app/api/**`, `lib/**`, scripts `scripts/**`).

- **Declarada no canônico?** — tabela listada em `db-schema.yml` (runtime ou legado).
- **Existe no snapshot CI?** — tabela presente em `docs/_snapshots/DB_SCHEMA_SNAPSHOT.json` (metadata.tables).
- **Usada no código?** — tabela referenciada via `.from("...")` em app/api, lib ou scripts.
- **Divergência?** — nota quando há diferença entre as três fontes.

---

| Tabela | Declarada no canônico? | Existe no snapshot CI? | Usada no código? | Divergência? |
|--------|------------------------|------------------------|------------------|--------------|
| admin_audit_log | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_auth_tokens | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_permissions | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_role_permissions | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_roles | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_user_permissions | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| admin_users | Não | Não | Sim | Fora do canônico e do snapshot; só código (admin). |
| alert_dispatch_log | Não | Não | Sim | Fora do canônico e do snapshot; só código (alertas). |
| alert_dlq | Não | Não | Sim | Fora do canônico e do snapshot; só código (alertas). |
| alert_outbox | Não | Não | Sim | Fora do canônico e do snapshot; só código (alertas). |
| alert_routes | Não | Não | Sim | Fora do canônico e do snapshot; só código (alertas). |
| ciclos | Sim | Sim | Sim | — |
| condominio_maquinas | Sim | Sim | Sim | — |
| condominios | Sim | Não | Sim | Snapshot CI não inclui; canônico preenchido (id, nome). |
| eventos_iot | Sim | Sim | Sim | — |
| gateways | Sim | Sim | Sim | — |
| iot_commands | Sim | Sim | Sim | — |
| iot_eventos | Sim (legado) | Não | Sim | Legado no canônico; usada em lib/iot (read-only); não no snapshot. |
| kits_operacionais | Sim | Não | Sim | Snapshot CI não inclui; canônico preenchido a partir da migration. |
| meta_columns | Não | Não | Sim | Só em scripts/db-snapshot.mjs (RPC meta); não tabela runtime. |
| meta_enum_values | Não | Não | Sim | Só em scripts/db-snapshot.mjs (RPC meta); não tabela runtime. |
| pagamentos | Sim | Sim | Sim | — |
| pos_devices | Sim | Sim | Sim | — |
| precos_ciclo | Sim | Sim | Sim | — |

---

**Fontes:** `docs/db-schema.yml`, `docs/_snapshots/DB_SCHEMA_SNAPSHOT.json`, grep `.from("...")` em `app/api/**`, `lib/**`, `scripts/**`.  
**Gerado:** 2026-02-19. Não altera runtime; apenas documentação.
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace