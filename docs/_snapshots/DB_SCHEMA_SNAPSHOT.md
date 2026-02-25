# Snapshot do Schema — Dashboard Nexus

- Branch: test/e2e-full-runner
- Commit: 356279953002ad1cf1c7647c43faa46a9630ee48
- Schema: public
- Safe mode: ON
- Fonte: rpc
- Ambiente(s): https://ci.metalav.com.br, https://api.metalav.com.br

Tabelas monitoradas: ciclos, condominio_maquinas, eventos_iot, gateways, iot_commands, pagamentos, pos_devices, precos_ciclo, kit_transfers, kit_resets

---

## ciclos
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `pagamento_id` | uuid | ❌ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `status` | ciclo_status | ❌ | `'AGUARDANDO_LIBERACAO'::ciclo_status` | ABORTADO, AGUARDANDO_LIBERACAO, EM_USO, FINALIZADO, LIBERADO |
| `busy_on_at` | timestamptz | ✅ | - | - |
| `busy_off_at` | timestamptz | ✅ | - | - |
| `eta_livre_at` | timestamptz | ✅ | - | - |
| `pulso_enviado_at` | timestamptz | ✅ | - | - |
| `pulso_confirmado` | bool | ❌ | `false` | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `updated_at` | timestamptz | ❌ | `now()` | - |

---

## condominio_maquinas
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `condominio_id` | uuid | ❌ | - | - |
| `tipo` | tipo_maquina | ❌ | - | lavadora, secadora |
| `identificador_local` | text | ❌ | - | - |
| `ativa` | bool | ❌ | `true` | - |
| `duracao_ciclo_min` | int4 | ❌ | `35` | - |
| `buffer_retirada_min` | int4 | ❌ | `5` | - |
| `gateway_id` | uuid | ✅ | - | - |
| `pos_device_id` | uuid | ✅ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `updated_at` | timestamptz | ❌ | `now()` | - |

---

## eventos_iot
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `gateway_id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ✅ | - | - |
| `tipo` | iot_evento_tipo | ❌ | - | BUSY_OFF, BUSY_ON, ERRO, HEARTBEAT, PULSO_ENVIADO |
| `payload` | jsonb | ❌ | `'{}'::jsonb` | - |
| `created_at` | timestamptz | ❌ | `now()` | - |

---

## gateways
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `condominio_id` | uuid | ❌ | - | - |
| `serial` | text | ❌ | - | - |
| `modelo` | text | ✅ | - | - |
| `fw_version` | text | ✅ | - | - |
| `last_seen_at` | timestamptz | ✅ | - | - |
| `ip_local` | text | ✅ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `updated_at` | timestamptz | ❌ | `now()` | - |
| `token` | text | ✅ | - | - |
| `busy` | bool | ❌ | `false` | - |
| `last_status_at` | timestamptz | ✅ | - | - |
| `firmware_version` | text | ✅ | - | - |
| `rssi` | int4 | ✅ | - | - |
| `condominium_id` | uuid | ✅ | - | - |

---

## iot_commands
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `gateway_id` | uuid | ❌ | - | - |
| `condominio_maquinas_id` | uuid | ❌ | - | - |
| `cmd_id` | uuid | ❌ | - | - |
| `tipo` | text | ❌ | - | - |
| `payload` | jsonb | ❌ | `'{}'::jsonb` | - |
| `status` | text | ❌ | `'PENDENTE'::text` | - |
| `expires_at` | timestamptz | ❌ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `ack_at` | timestamptz | ✅ | - | - |

---

## pagamentos
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `tenant_id` | uuid | ❌ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `origem` | pag_origem | ❌ | - | APP, POS |
| `pos_device_id` | uuid | ✅ | - | - |
| `pos_serial` | text | ✅ | - | - |
| `metodo` | pag_metodo | ❌ | - | CARTAO, PIX |
| `gateway_pagamento` | pag_gateway | ❌ | - | ASAAS, STONE |
| `valor_centavos` | int4 | ❌ | - | - |
| `status` | pag_status | ❌ | `'CRIADO'::pag_status` | CANCELADO, CRIADO, ESTORNADO, EXPIRADO, FALHOU, PAGO |
| `external_id` | text | ✅ | - | - |
| `idempotency_key` | text | ❌ | - | - |
| `client_request_id` | text | ✅ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `paid_at` | timestamptz | ✅ | - | - |

**Índices UNIQUE (idempotência; NÃO global por tenant):**
- `pagamentos_tenant_pos_device_client_request_key`: UNIQUE (tenant_id, pos_device_id, client_request_id) WHERE client_request_id IS NOT NULL AND pos_device_id IS NOT NULL
- `pagamentos_tenant_pos_serial_client_request_key`: UNIQUE (tenant_id, pos_serial, client_request_id) WHERE client_request_id IS NOT NULL AND pos_device_id IS NULL AND pos_serial IS NOT NULL

---

## pos_devices
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `condominio_id` | uuid | ❌ | - | - |
| `serial` | text | ❌ | - | - |
| `stone_merchant_id` | text | ✅ | - | - |
| `app_version` | text | ✅ | - | - |
| `last_seen_at` | timestamptz | ✅ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `updated_at` | timestamptz | ❌ | `now()` | - |

---

## precos_ciclo
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `maquina_id` | uuid | ❌ | - | - |
| `valor_centavos` | int4 | ❌ | - | - |
| `vigente_desde` | timestamptz | ❌ | `now()` | - |
| `vigente_ate` | timestamptz | ✅ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |

---

## kit_transfers (2026-02-25)
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `tenant_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `admin_subject` | text | ✅ | - | - |
| `from_condominio_id` | uuid | ❌ | - | - |
| `to_condominio_id` | uuid | ❌ | - | - |
| `pos_device_id` | uuid | ❌ | - | - |
| `gateway_id` | uuid | ❌ | - | - |
| `reason` | text | ✅ | - | - |
| `metadata` | jsonb | ✅ | - | - |

## kit_resets (2026-02-25)
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | - |
| `tenant_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `admin_subject` | text | ✅ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `pos_device_id` | uuid | ❌ | - | - |
| `gateway_id` | uuid | ❌ | - | - |
| `reason` | text | ✅ | - | - |
| `metadata` | jsonb | ✅ | - | - |

---

## RPC (Fonte da Verdade)

- **rpc_confirm_and_enqueue** (db/migrations/20260222_rpc_confirm_and_enqueue.sql): transacional; advisory lock por provider_ref ou payment_id; atualiza pagamento → PAGO (se p_provider_ref+p_result), cria/reutiliza ciclo e iot_command. Idempotente por execute_idempotency_key + ciclo_id no payload. Retorno: ok, pagamento_id, pagamento_status, ciclo_id, ciclo_status, iot_command_id, command_id, iot_command_status, already_processed.

---

> SQL auxiliar para RPC read-only: docs/_snapshots/rpc_nexus_db_schema_snapshot.sql