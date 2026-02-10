# Runbook — Compensação de Pagamentos (Software-First)

## Objetivo
Operar scan/execute de compensação com segurança, observabilidade e rollback rápido.

## Pré-check
1. API no ar (`npm run dev` ou serviço)
2. Endpoint responde 200 em health básico
3. Variáveis de modo conferidas:
   - `PAYMENTS_COMPENSATION_MODE`
   - secrets de provider (se `real`)

## Execução manual

### Scan (marcar EXPIRADO)
```powershell
$bodyScan = @{ sla_sec = 180; limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:3000/api/payments/compensation/scan" -ContentType "application/json" -Body $bodyScan
```

### Execute (estornar)
```powershell
$bodyExec = @{ limit = 10 } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:3000/api/payments/compensation/execute" -ContentType "application/json" -Body $bodyExec
```

## Interpretação de saída
- `mode=phase2-executor:simulate` → sem estorno externo
- `mode=phase2-executor:real` → adapter real ativo
- `refunded_count` > 0 → compensações aplicadas
- `skipped` com `stone_not_configured`/`asaas_not_configured` → falta configuração

## Incidente / rollback
1. Setar `PAYMENTS_COMPENSATION_MODE=simulate`
2. Reiniciar serviço
3. Executar scan/execute com `limit` baixo
4. Auditar `errors`/`skipped`

## Evidências mínimas
- stdout dos comandos scan/execute
- lista de `payment_id` processados
- status final em `pagamentos` (`EXPIRADO`/`ESTORNADO`)
