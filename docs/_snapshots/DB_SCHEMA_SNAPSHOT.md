# Snapshot do Schema — Dashboard Nexus

- Branch: test/e2e-full-runner
- Commit: 356279953002ad1cf1c7647c43faa46a9630ee48
- Schema: public
- Safe mode: ON
- Fonte: rpc
- Ambiente(s): https://ci.metalav.com.br, https://api.metalav.com.br

Tabelas monitoradas: ciclos, condominio_maquinas, eventos_iot, gateways, iot_commands, pagamentos, pos_devices, precos_ciclo

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
| `condominio_id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `origem` | pag_origem | ❌ | - | APP, POS |
| `metodo` | pag_metodo | ❌ | - | CARTAO, PIX |
| `gateway_pagamento` | pag_gateway | ❌ | - | ASAAS, STONE |
| `valor_centavos` | int4 | ❌ | - | - |
| `status` | pag_status | ❌ | `'CRIADO'::pag_status` | CANCELADO, CRIADO, ESTORNADO, EXPIRADO, FALHOU, PAGO |
| `external_id` | text | ✅ | - | - |
| `idempotency_key` | text | ❌ | - | - |
| `created_at` | timestamptz | ❌ | `now()` | - |
| `paid_at` | timestamptz | ✅ | - | - |

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


> SQL auxiliar para RPC read-only: docs/_snapshots/rpc_nexus_db_schema_snapshot.sql