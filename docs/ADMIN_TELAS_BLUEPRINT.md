# Blueprint — Telas Admin (Condomínio, Gateway, POS, Máquinas)

## Premissas canônicas
- Fonte de verdade: tabelas PT-BR runtime.
- Arquitetura backend-first.
- **Vínculo físico 1:1:** `1 máquina = 1 gateway` e `1 gateway = 1 máquina`.
- POS vincula com máquina para autorização operacional.

---

## 1) Tela: Condomínios/Lojas

### Objetivo
Criar e manter cadastro base do condomínio/loja.

### Campos mínimos
- `nome` (obrigatório)
- `ativo` (bool, default true)
- `timezone` (default `America/Cuiaba`)

### APIs
- `GET /api/admin/condominios?search=&page=&limit=`
- `POST /api/admin/condominios`
- `PATCH /api/admin/condominios/:id`
- `GET /api/admin/condominios/:id`

### Validações
- `nome` não vazio
- bloquear duplicado exato por `nome` ativo (regra de negócio configurável)

---

## 2) Tela: Gateways

### Objetivo
Cadastrar gateway físico por condomínio.

### Campos mínimos
- `serial` (obrigatório, único global)
- `condominio_id` (obrigatório)
- `status` (ativo/inativo)
- metadados opcionais: firmware, modelo, última conexão

### APIs
- `GET /api/admin/gateways?condominio_id=&search=`
- `POST /api/admin/gateways`
- `PATCH /api/admin/gateways/:id`
- `GET /api/admin/gateways/:id`

### Validações
- `serial` único
- `condominio_id` válido
- **não excluir gateway com máquina ativa vinculada** (usar inativação)

---

## 3) Tela: POS Devices

### Objetivo
Cadastrar terminais POS por condomínio.

### Campos mínimos
- `serial` (obrigatório, único)
- `condominio_id` (obrigatório)
- `ativo` (bool)

### APIs
- `GET /api/admin/pos-devices?condominio_id=&search=`
- `POST /api/admin/pos-devices`
- `PATCH /api/admin/pos-devices/:id`
- `GET /api/admin/pos-devices/:id`

### Validações
- `serial` único
- `condominio_id` válido
- inativação bloqueada se houver operação crítica em andamento (opcional)

---

## 4) Tela: Máquinas

### Objetivo
Cadastrar máquina e vincular de forma íntegra com gateway + POS.

### Campos mínimos
- `condominio_id` (obrigatório)
- `identificador_local` (obrigatório, ex.: LAV-01)
- `tipo` (`lavadora` | `secadora`)
- `gateway_id` (obrigatório)
- `pos_device_id` (obrigatório)
- `ativa` (bool)

### APIs
- `GET /api/admin/maquinas?condominio_id=&tipo=&ativa=`
- `POST /api/admin/maquinas`
- `PATCH /api/admin/maquinas/:id`
- `GET /api/admin/maquinas/:id`

### Validações críticas
1. `identificador_local` único por condomínio
2. `gateway_id` e `pos_device_id` pertencem ao mesmo `condominio_id`
3. **Regra 1:1 gateway-máquina:**
   - bloquear `gateway_id` já vinculado a outra máquina ativa
4. bloquear ativação de máquina sem `gateway_id` e `pos_device_id`

---

## 5) Regras transversais (backend)

### Auditoria
- registrar `created_at`, `updated_at`, `updated_by`
- trilha de mudança de vínculo (`gateway_id`, `pos_device_id`)

### Segurança
- endpoints admin protegidos por role
- validação server-side obrigatória (UI não é fonte de verdade)

### Erro canônico
- resposta compatível: `error` + `error_v1 { code, message }`

---

## 6) Sequência operacional recomendada (UI)
1. Criar condomínio
2. Criar gateway
3. Criar POS
4. Criar máquina e vincular gateway+POS
5. Cadastrar preço por máquina (`precos_ciclo`)
6. Ativar operação

---

## 7) Critérios de aceite
- Não existe máquina ativa sem gateway/POS.
- Não existe gateway ativo vinculado a mais de uma máquina.
- `authorize` só funciona para máquina vinculada ao POS correto.
- Fluxo canônico permanece verde após cadastros via admin.
