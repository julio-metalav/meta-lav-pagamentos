# Meta-Lav Pagamentos — Arquitetura por Blocos (Backend First, Multi-Canal)

## Objetivo
Padronizar a evolução do sistema de pagamentos/IoT para evitar efeito dominó e retrabalho quando novos canais entrarem (POS, mobile, web, kiosk).

## Princípio canônico
**O backend não depende do canal.**

Se o backend funcionar sem saber se quem chamou foi POS ou App, o design está correto.

---

## Fonte única da verdade (runtime)
Tabelas PT-BR no runtime:
- `pagamentos`
- `ciclos`
- `iot_commands`
- `eventos_iot`
- `gateways`
- `condominio_maquinas`
- `precos_ciclo`
- (demais tabelas PT-BR canônicas conforme `docs/db-schema.yml`)

Tabelas EN legado são **read-only** e não entram em regra de negócio runtime.

---

## Blocos da aplicação

### 1) `lib/db/` (acesso a dados)
Responsabilidades:
- cliente admin (`supabaseAdmin`)
- constantes de tabelas runtime
- helpers de query e seleção mínima

Regras:
- sem regra de negócio de domínio
- sem decisões por canal

### 2) `lib/iot/` (domínio IoT)
Responsabilidades:
- autenticação HMAC (fonte única)
- serviços de domínio (`poll`, `ack`, `evento`, `heartbeat`)
- status e transições de comandos/ciclos

Regras:
- rotas só fazem parse + chama service
- sem duplicação de auth HMAC

### 3) `lib/pos/` (domínio de pagamentos POS)
Responsabilidades:
- autorização/confirmação de pagamento
- vínculo com ciclo/comando
- validações de fluxo

Regras:
- POS não define preço nem regra
- POS não libera máquina diretamente

### 4) `lib/dev/` (ferramentas de desenvolvimento)
Responsabilidades:
- enqueue de comandos dev
- utilidades de teste local

Regras:
- bloqueado em produção
- alinhado ao runtime PT-BR (`iot_commands`, `condominio_maquinas_id`)

### 5) `app/api/**` (borda HTTP)
Responsabilidades:
- parse de request
- validação básica de payload
- chamada de service
- retorno JSON

Regras:
- rotas finas
- sem regra de negócio pesada

---

## Modelo multi-canal (obrigatório)
Todos os fluxos devem aceitar:
- `channel`: `pos | mobile | web | kiosk`
- `origin`:
  - POS -> `pos_device_id`
  - App/Web -> `user_id`

**Nunca assumir que pagamento é do POS.**

---

## Fluxo único de pagamento (todos os canais)
1. `availability`
2. `price`
3. `authorize`
4. `confirm`
5. `execute_cycle`

Backend controla:
- preço
- regras
- retry
- timeout
- idempotência

Canal apenas consome API.

---

## Regras de domínio obrigatórias
- Preço é sempre decisão do backend (`GET /price` ou equivalente de domínio)
- Canal não calcula promoção/regra
- Domínio preparado para concorrência:
  - reservado
  - expirado
  - no-show
  - cancelamento
- Erros claros de estado (`409 reserved`, `410 expired`, etc.)

---

## Event-first
Eventos mínimos por transação:
- `payment_authorized`
- `payment_confirmed`
- `cycle_started`
- `cycle_finished`
- `payment_failed`
- `payment_refunded`

Usos:
- auditoria
- histórico de usuário
- dashboard operacional

---

## Guardrails anti-quebra
Scripts obrigatórios:
- `npm run anti-legado`
- `npm run hardening`
- `npm run check`
- `npm run smoke`

Objetivo:
- bloquear uso de legado EN em rotas runtime
- bloquear estrutura inválida em `app/api`
- garantir build/introspect/smoke consistentes

---

## Rotina operacional por mudança
Antes de commit:
```bash
git status --short
git diff --stat
```

Validação:
```bash
npm run build
npm run check
```

Validação ampliada:
```bash
npm run smoke
```

---

## O que não fazer
- Não criar lógica específica de POS no core
- Não espalhar `if (channel === 'pos')` em domínio
- Não duplicar fluxo para app no futuro
- Não usar tabelas EN legado em runtime

---

## Continuidade
Este documento deve ser atualizado quando:
- novo bloco for introduzido
- contrato de fluxo mudar
- novos estados de domínio forem adicionados
