# POS → Payments → IoT — Contract v1

Status: v1 (congelado)
Escopo: somente documentação. Nenhuma mudança de runtime.

1) Visão Geral do Fluxo
- POS inicia pagamento via /api/pos/authorize
- Provedor confirma via /api/payments/confirm
- Sistema libera máquina e agenda comando via /api/payments/execute-cycle
- Gateway IoT busca comandos pendentes via /api/iot/poll
- Gateway envia confirmação de recebimento via /api/iot/ack
- Gateway publica eventos relevantes via /api/iot/evento

2) Endpoint Specs (fonte: código das rotas)

2.1 POST /api/pos/authorize
- Método/Path: POST /api/pos/authorize
- Auth: valida POS e máquina via Supabase; sem token explícito na rota; sujeita a rollout/canary por condomínio
- Headers de correlação: x-correlation-id (opcional)
- Request JSON (parseAuthorizeInput):
  - pos_serial: string (obrigatório)
  - identificador_local: string (obrigatório) — identifica a máquina no POS
  - valor_centavos: number (obrigatório)
  - metodo: string ("PIX" | "CARTAO") (obrigatório)
  - idempotency_key: string (opcional) — se ausente, calculada como `pos:{pos_serial}:{identificador_local}:{valor_centavos}:{metodo}:{minuteBucket}`
  - quote: objeto (opcional) — se presente, valida:
    - valid_until: string ISO (obrigatório no objeto quote)
    - pricing_hash: string iniciando com "sha256:" (obrigatório no objeto quote)
- Regras/validações:
  - POS deve existir (pos_devices.serial)
  - Máquina deve existir e estar vinculada ao POS (condominio_maquinas.pos_device_id)
  - Máquina deve estar ativa e ter gateway_id
  - Rollout canary deve permitir authorize para o condominio_id
  - Idempotência por idempotency_key (reaproveita pagamento existente)
- Response JSON (200):
  - ok: true
  - reused: boolean
  - correlation_id: string
  - pagamento_id: string
  - pagamento_status: string
- Erros (exemplos):
  - 400 { code: "invalid_quote" | "expired" | "invalid_quote_hash" | parse errors }
  - 401 { code: "pos_not_found" }
  - 403 { code: "canary_not_allowed" }
  - 404 { code: "machine_not_found" }
  - 409 { code: "machine_inactive" | "missing_gateway_id" }
  - 500 { code: "db_error" | "internal_error" }

2.2 POST /api/payments/confirm
- Método/Path: POST /api/payments/confirm
- Auth: lógica no backend; sem token explícito na rota
- Headers: x-correlation-id (opcional)
- Request JSON (parseConfirmInput):
  - payment_id: string (obrigatório)
  - provider: "stone" | "asaas" (obrigatório)
  - provider_ref: string (obrigatório)
  - result: "approved" | outro (obrigatório)
- Regras:
  - Dedupe forte por provider+provider_ref (replay seguro)
  - Se payment status final (PAGO/ESTORNADO/CANCELADO), replay ok (idempotente)
  - Se external_id já igual, replay ok
  - Se approved → marca PAGO e paid_at agora
- Response JSON (200):
  - ok: true
  - correlation_id: string
  - payment_id: string
  - status: "confirmed" | "failed"
- Erros:
  - 404 { code: "payment_not_found" }
  - 500 { code: "db_error" | "internal_error" }

2.3 POST /api/payments/execute-cycle
- Método/Path: POST /api/payments/execute-cycle
- Auth: lógica no backend
- Headers: x-correlation-id (opcional)
- Request JSON (parseExecuteCycleInput):
  - payment_id: string (obrigatório)
  - condominio_maquinas_id: string (obrigatório)
  - idempotency_key: string (obrigatório) — usado para dedupe do comando IoT
  - channel: string (opcional) (propagado no payload do comando)
  - origin: objeto (opcional) (propagado no payload do comando)
- Regras:
  - payment.status deve ser PAGO (senão 409 payment_not_confirmed)
  - Máquina deve existir, pertencer ao mesmo condomínio do pagamento, estar ativa e ter gateway_id
  - Se já existe ciclo recente aguardando liberação:
    - TTL PENDING_TTL_SEC (default 300s). Se expirado, marca ciclo como ABORTADO e retorna 409 cycle_expired
  - Cria ciclo se não houver
  - Idempotência do comando IoT por (gateway_id + execute_idempotency_key + ciclo_id)
  - Comando criado em iot_commands com tipo "PULSE", status "pendente" e expires_at (+5m)
- Response JSON (200):
  - ok: true
  - correlation_id: string
  - cycle_id: string
  - command_id: string
  - status: "queued"
- Erros:
  - 404 { code: "payment_not_found" | "machine_not_found" }
  - 409 { code: "payment_not_confirmed" | "cycle_expired" | "missing_gateway_id" }
  - 500 { code: "db_error" | "cycle_create_failed" | "iot_command_create_failed" | "internal_error" }

2.4 GET /api/iot/poll
- Método/Path: GET /api/iot/poll?limit=5..20
- Auth:
  - Produção: HMAC via authenticateGateway (serial do gateway)
  - Dev: permite gateway_id via querystring (sem HMAC)
- Request:
  - Query: limit (1..20; default clamp 5..20)
- Response JSON: corpo do pollCommands (lista de comandos pendentes). Campos observados nos inserts de iot_commands:
  - gateway_id, cmd_id, payload{ pulses, ciclo_id, pagamento_id, execute_idempotency_key, identificador_local, tipo_maquina, channel, origin }, status
- Erros: segundo pollCommands (não exposto aqui; seguir implementação de lib/iot/service)

2.5 POST /api/iot/ack
- Método/Path: POST /api/iot/ack
- Auth: HMAC (mesma de /poll)
- Request JSON: corpo consumido por ackCommand; campos esperados (conforme comentário da rota):
  - cmd_id: string (obrigatório)
  - ok: boolean (obrigatório)
  - ts: string/number (opcional)
  - machine_id?: string (opcional)
  - code?: string (opcional)
- Efeito: atualiza iot_commands.status e ack_at; pode registrar log em iot_acks
- Response JSON: conforme ackCommand

2.6 POST /api/iot/evento
- Método/Path: POST /api/iot/evento
- Auth: HMAC
- Request JSON: conforme recordEvento (eventos_iot)
- Response JSON: conforme recordEvento

3) Invariantes
- Correlação: x-correlation-id propagado quando presente; default para UUID
- Idempotência:
  - authorize: idempotency_key (reaproveita pagamento)
  - confirm: provider+provider_ref e external_id
  - execute-cycle: execute_idempotency_key + ciclo_id + gateway_id
  - iot_commands: status e timestamps dão dedupe natural
- Segurança:
  - HMAC obrigatório para /iot/* em produção
  - Canário (rollout) pode bloquear authorize por condomínio
- Integridade de preço (quando quote presente): pricing_hash com prefixo "sha256:" e validade (valid_until)

4) Estados e Transições (pagamento/ciclo)
- Pagamento: CRIADO → PAGO | FALHOU | ESTORNADO | CANCELADO (confirm ajusta estado)
- Ciclo: AGUARDANDO_LIBERACAO → (envio comando) → ACK/EXECUCAO (fora do escopo deste doc) → FINALIZADO/ABORTADO
- Expiração de ciclo pendente: após TTL, marca ABORTADO

5) Checklist E2E (simulação)
- authorize:
  curl -s -X POST http://localhost:3000/api/pos/authorize \
    -H 'content-type: application/json' \
    -d '{"pos_serial":"SERIAL123","identificador_local":"01","valor_centavos":500,"metodo":"PIX","idempotency_key":"demo-1"}'
- confirm (aprovado):
  curl -s -X POST http://localhost:3000/api/payments/confirm \
    -H 'content-type: application/json' \
    -d '{"payment_id":"<ID>","provider":"stone","provider_ref":"stone_pos_demo_1","result":"approved"}'
- execute-cycle:
  curl -s -X POST http://localhost:3000/api/payments/execute-cycle \
    -H 'content-type: application/json' \
    -d '{"payment_id":"<ID>","condominio_maquinas_id":"<MAQ>","idempotency_key":"exec-1","channel":"pos","origin":{"pos_device_id":null,"user_id":null}}'
- poll (dev):
  curl -s "http://localhost:3000/api/iot/poll?gateway_id=<GW>&limit=5"
- ack:
  curl -s -X POST http://localhost:3000/api/iot/ack -H 'content-type: application/json' -d '{"cmd_id":"<CMD>","ok":true}'
- evento:
  curl -s -X POST http://localhost:3000/api/iot/evento -H 'content-type: application/json' -d '{"type":"cycle_started","cmd_id":"<CMD>","meta":{}}'

6) Do Not Break (v1 freeze)
- /api/pos/authorize: campos pos_serial, identificador_local, valor_centavos, metodo, idempotency_key (semântica/nomes)
- /api/payments/confirm: payment_id, provider, provider_ref, result
- /api/payments/execute-cycle: payment_id, condominio_maquinas_id, idempotency_key; payload do comando: execute_idempotency_key, ciclo_id, pagamento_id, identificador_local, tipo_maquina
- /api/iot/poll: semântica de pending/ack, query limit
- /api/iot/ack: cmd_id e ok
- /api/iot/evento: contrato de eventos (mínimo: aceitar tipo + metadados)
