# Snapshot do Schema — Dashboard Nexus

- Gerado em: 2026-02-15T13:45:04.927Z
- Branch: test/e2e-full-runner
- Commit: 6e8d6b3722e0567e6c7d3224502bd39a3c22dfe7
- Schema: public
- Safe mode: ON
- Fonte: meta_columns
- Ambiente(s): https://ci.metalav.com.br, https://api.metalav.com.br

Tabelas monitoradas: pagamentos, ciclos, iot_commands, eventos_iot, gateways, pos_devices, condominio_maquinas, precos_ciclo

---

## pagamentos
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `condominio_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `external_id` | text | ✅ | - | - |
| `gateway_pagamento` | pag_gateway | ❌ | - | ASAAS, STONE |
| `id` | uuid | ❌ | - | - |
| `idempotency_key` | text | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `metodo` | pag_metodo | ❌ | - | PIX, CARTAO |
| `origem` | pag_origem | ❌ | - | POS, APP |
| `paid_at` | timestamptz | ✅ | - | - |
| `status` | pag_status | ❌ | - | CRIADO, PAGO, CANCELADO, ESTORNADO, EXPIRADO, FALHOU |
| `valor_centavos` | int4 | ❌ | - | - |

---

## ciclos
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `busy_off_at` | timestamptz | ✅ | - | - |
| `busy_on_at` | timestamptz | ✅ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `eta_livre_at` | timestamptz | ✅ | - | - |
| `id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `pagamento_id` | uuid | ❌ | - | - |
| `pulso_confirmado` | bool | ❌ | - | - |
| `pulso_enviado_at` | timestamptz | ✅ | - | - |
| `status` | ciclo_status | ❌ | - | AGUARDANDO_LIBERACAO, LIBERADO, EM_USO, FINALIZADO, ABORTADO |
| `updated_at` | timestamptz | ❌ | - | - |

---

## iot_commands
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `ack_at` | timestamptz | ✅ | - | - |
| `cmd_id` | uuid | ❌ | - | - |
| `condominio_maquinas_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `expires_at` | timestamptz | ❌ | - | - |
| `gateway_id` | uuid | ❌ | - | - |
| `id` | uuid | ❌ | - | - |
| `payload` | jsonb | ❌ | - | - |
| `status` | text | ❌ | - | - |
| `tipo` | text | ❌ | - | - |

---

## eventos_iot
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `created_at` | timestamptz | ❌ | - | - |
| `gateway_id` | uuid | ❌ | - | - |
| `id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ✅ | - | - |
| `payload` | jsonb | ❌ | - | - |
| `tipo` | iot_evento_tipo | ❌ | - | BUSY_ON, BUSY_OFF, PULSO_ENVIADO, HEARTBEAT, ERRO |

---

## gateways
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `busy` | bool | ❌ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `condominium_id` | uuid | ✅ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `firmware_version` | text | ✅ | - | - |
| `fw_version` | text | ✅ | - | - |
| `id` | uuid | ❌ | - | - |
| `ip_local` | text | ✅ | - | - |
| `last_seen_at` | timestamptz | ✅ | - | - |
| `last_status_at` | timestamptz | ✅ | - | - |
| `modelo` | text | ✅ | - | - |
| `rssi` | int4 | ✅ | - | - |
| `serial` | text | ❌ | - | - |
| `token` | text | ✅ | - | - |
| `updated_at` | timestamptz | ❌ | - | - |

---

## pos_devices
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `app_version` | text | ✅ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `id` | uuid | ❌ | - | - |
| `last_seen_at` | timestamptz | ✅ | - | - |
| `serial` | text | ❌ | - | - |
| `stone_merchant_id` | text | ✅ | - | - |
| `updated_at` | timestamptz | ❌ | - | - |

---

## condominio_maquinas
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `ativa` | bool | ❌ | - | - |
| `buffer_retirada_min` | int4 | ❌ | - | - |
| `condominio_id` | uuid | ❌ | - | - |
| `created_at` | timestamptz | ❌ | - | - |
| `duracao_ciclo_min` | int4 | ❌ | - | - |
| `gateway_id` | uuid | ✅ | - | - |
| `id` | uuid | ❌ | - | - |
| `identificador_local` | text | ❌ | - | - |
| `pos_device_id` | uuid | ✅ | - | - |
| `tipo` | tipo_maquina | ❌ | - | lavadora, secadora |
| `updated_at` | timestamptz | ❌ | - | - |

---

## precos_ciclo
| Coluna | Tipo Postgres | Nullable | Default | Enum |
|---|---|---|---|---|
| `created_at` | timestamptz | ❌ | - | - |
| `id` | uuid | ❌ | - | - |
| `maquina_id` | uuid | ❌ | - | - |
| `valor_centavos` | int4 | ❌ | - | - |
| `vigente_ate` | timestamptz | ✅ | - | - |
| `vigente_desde` | timestamptz | ❌ | - | - |

---


> SQL auxiliar para RPC read-only: docs/_snapshots/rpc_nexus_db_schema_snapshot.sql