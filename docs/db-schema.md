# Meta-Lav Pagamentos — Quadro Rígido do Banco (gerado)

**Fonte da verdade:** `docs/db-schema.yml`

## Regras
- Nunca usar tabelas legacy (EN) no runtime.
- Toda query/endpoint deve usar nomes deste arquivo.
- Enum: só valores listados aqui (nada de chute).
- Tabelas PT-BR são a fonte única da verdade no runtime.

---

## ciclos
- **table:** `ciclos`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Estado do ciclo por máquina (AGUARDANDO_LIBERACAO -> LIBERADO -> EM_USO -> FINALIZADO)

### Enums
- **status** (`ciclo_status`): AGUARDANDO_LIBERACAO, LIBERADO, EM_USO, FINALIZADO
  - _note:_ Se existirem outros valores reais no banco, atualizar aqui (via query enum_range).

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `pagamento_id` | `uuid` | ❌ |
| `condominio_id` | `uuid` | ✅ |
| `maquina_id` | `uuid` | ✅ |
| `status` | `ciclo_status` | ✅ |
| `pulso_enviado_at` | `timestamptz` | ❌ |
| `busy_on_at` | `timestamptz` | ❌ |
| `busy_off_at` | `timestamptz` | ❌ |
| `eta_livre_at` | `timestamptz` | ❌ |
| `pulso_confirmado` | `bool` | ❌ |
| `created_at` | `timestamptz` | ✅ |
| `updated_at` | `timestamptz` | ✅ |

### Queries úteis

**orphan_released_no_busy_on**

```sql
select id, created_at, status, pulso_enviado_at, busy_on_at, busy_off_at, maquina_id
from ciclos
where status = 'LIBERADO'
  and pulso_enviado_at is not null
  and busy_on_at is null
order by pulso_enviado_at desc;
```

---

## eventos_iot
- **table:** `eventos_iot`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Log canônico de eventos IoT (PULSO/BUSY_ON/BUSY_OFF) ligado ao gateway e à máquina (condominio_maquinas.id)

### Enums
- **tipo** (`iot_evento_tipo`): PULSO_ENVIADO, BUSY_ON, BUSY_OFF, HEARTBEAT, ERRO
  - _note:_ Se o banco tiver mais valores, atualizar aqui.

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `gateway_id` | `uuid` | ✅ |
| `maquina_id` | `uuid` | ❌ |
| `tipo` | `iot_evento_tipo` | ✅ |
| `payload` | `jsonb` | ✅ |
| `created_at` | `timestamptz` | ✅ |

### Queries úteis

**last_50**

```sql
select id, gateway_id, maquina_id, tipo, payload, created_at
from eventos_iot
order by created_at desc
limit 50;
```

---

## iot_commands
- **table:** `iot_commands`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Fila de comandos para gateways (pulso). Vínculo com ciclo via payload.ciclo_id

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `gateway_id` | `uuid` | ✅ |
| `cmd_id` | `uuid` | ✅ |
| `status` | `text` | ✅ |
| `tipo` | `text` | ❌ |
| `payload` | `jsonb` | ✅ |
| `condominio_maquinas_id` | `uuid` | ❌ |
| `created_at` | `timestamptz` | ✅ |

---

## condominio_maquinas
- **table:** `condominio_maquinas`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Cadastro de máquinas por condomínio (inclui identificador_local tipo LAV-01/SEC-01)

### Enums
- **tipo_maquina** (`tipo_maquina`): lavadora, secadora

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `condominio_id` | `uuid` | ✅ |
| `gateway_id` | `uuid` | ✅ |
| `identificador_local` | `text` | ✅ |
| `tipo_maquina` | `tipo_maquina` | ✅ |

---

## gateways
- **table:** `gateways`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Cadastro de gateways (serial, last_seen, condominio_id)

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `serial` | `text` | ✅ |
| `condominio_id` | `uuid` | ✅ |
| `last_seen` | `timestamptz` | ❌ |

---

## pos_devices
- **table:** `pos_devices`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Cadastro de POS (Stone/Sunmi) por condomínio

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `serial` | `text` | ✅ |
| `condominio_id` | `uuid` | ✅ |

---

## pagamentos
- **table:** `pagamentos`
- **canonical/runtime:** ✅ / ✅
- **purpose:** Pagamentos (Pix/cartão) e vínculo com ciclo(s)

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `uuid` | ✅ |
| `condominio_id` | `uuid` | ✅ |
| `metodo` | `text` | ✅ |
| `valor` | `numeric` | ✅ |
| `status` | `text` | ✅ |
| `created_at` | `timestamptz` | ✅ |

---

## iot_events
- **table:** `iot_events`
- **canonical/runtime:** ❌ / ❌
- **read_only:** ✅
- **purpose:** LEGADO (EN). Não usar no runtime. Logs antigos/compatibilidade.

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `bigint` | ✅ |
| `serial` | `text` | ✅ |
| `machine_id` | `text` | ✅ |
| `event_id` | `text` | ✅ |
| `type` | `text` | ✅ |
| `payload` | `jsonb` | ✅ |
| `created_at` | `timestamptz` | ✅ |

### Regras
- NÃO USAR no runtime
- Somente leitura/migração

---

## iot_eventos
- **table:** `iot_eventos`
- **canonical/runtime:** ❌ / ✅
- **purpose:** LEGADO local (compat). Mantido por compatibilidade; não é fonte da verdade.

### Colunas
| coluna | tipo | required |
|---|---|---|
| `id` | `bigint\|uuid` | ✅ |
| `gw_serial` | `text` | ✅ |
| `ts_gw` | `int` | ✅ |
| `tipo` | `text` | ✅ |
| `payload` | `jsonb` | ✅ |
| `raw_body` | `text` | ✅ |
| `hmac_ok` | `bool` | ✅ |
| `created_at` | `timestamptz` | ✅ |

---
