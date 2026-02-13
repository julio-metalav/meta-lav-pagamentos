# E2E SMOKE V1 — POS→Payments→IoT

Objetivo: valida o fluxo mínimo baseado no contract-v1 (authorize → confirm → execute-cycle → iot poll → iot ack → iot evento).

Requisitos:
- Next app rodando (BASE_URL aponta para ele; default http://localhost:3000)
- jq instalado
- Env de teste válido no banco (POS/Máquina/Gateway); informar CONDOMINIO_MAQUINAS_ID

Variáveis:
- BASE_URL (opcional; default http://localhost:3000)
- CONDOMINIO_MAQUINAS_ID (obrigatório)
- POS_SERIAL (default POS-TESTE-001)
- IDENTIFICADOR_LOCAL (default LAV-01)
- VALOR_CENTAVOS (default 1600)
- METODO (default PIX)
- PROVIDER (default stone)
- PROVIDER_REF (default TEST-<timestamp>)
- GATEWAY_ID (opcional; tenta /iot/poll?gateway_id=... em dev)

Uso:
```bash
cd /mnt/d/pagamentos
CONDOMINIO_MAQUINAS_ID="<ID>" \
  ./scripts/e2e-smoke-v1.sh
```

Saída esperada (resumo):
```
pagamento_id=...
cycle_id=...
command_id=...
E2E SMOKE v1 OK
```

Troubleshooting:
- 401/403 em /api/iot/poll: ambiente provavelmente requer HMAC. Execute o modo HMAC de exemplo:
  - scripts/e2e-hmac-demo.sh
- missing cycle_id/command_id: verifique se o payment foi confirmado como PAGO e se a máquina tem gateway_id
- 404 machine/payment: ids inválidos ou ambiente sem seed adequado
