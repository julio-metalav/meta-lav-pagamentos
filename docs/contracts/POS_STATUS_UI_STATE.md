# GET /api/pos/status — ui_state (contrato UX)

Fonte: `app/api/pos/status/route.ts` (função `parseUiState`).  
Uso: POS (Android/Compose) e qualquer cliente que consuma o status para exibir mensagem e ação.

## Valores canônicos de `ui_state`

| ui_state | Mensagem sugerida (POS) | Ação |
|----------|-------------------------|------|
| **AGUARDANDO_PAGAMENTO** | "Processando pagamento…" | Mostrar indicador de progresso; continuar polling. |
| **PAGO** | "Pagamento aprovado" | Aguardar execute-cycle / próximo estado. |
| **LIBERANDO** | "Liberando máquina…" | Mostrar indicador; continuar polling. |
| **EM_USO** | "Máquina em uso" | Informar usuário; opcionalmente continuar polling até FINALIZADO. |
| **FINALIZADO** | "Máquina pronta" + "Pressione INICIAR na máquina para começar." | Parar polling; botão Voltar. |
| **LIVRE** | "Toque para iniciar" (idle; máquina disponível) | Parar polling; voltar à tela 1 ou exibir copy de idle. |
| **EXPIRADO** | "Pagamento expirado" | Parar polling; botão Voltar. |
| **ERRO** | "Algo deu errado" | Parar polling; botão Voltar. |
| **ESTORNANDO** | "Não conseguimos iniciar a máquina" + "Estorno automático em andamento…" | **Continuar polling** até ESTORNADO (ou ERRO). |
| **ESTORNADO** | "Estorno confirmado" | Parar polling; botão Voltar. |

## Regras no backend

- **ESTORNANDO:** `ciclo.status == "ABORTADO"` e `pagamento.status == "PAGO"` (máquina não respondeu; estorno em andamento).
- **ESTORNADO:** `ciclo.status == "ABORTADO"` e `pagamento.status == "ESTORNADO"`.
- **LIVRE (sem pagamento):** sem ciclo, ou `ciclo.status` em `FINALIZADO` ou `ABORTADO` → `availability = "LIVRE"`.

## Estados terminais (parar polling)

O cliente deve parar o poll quando `ui_state` for um de: **LIVRE**, **FINALIZADO**, **ESTORNADO**, **EXPIRADO**, **ERRO**.  
**ESTORNANDO** não é terminal: continuar polling até evoluir para **ESTORNADO** (ou **ERRO**).

## Debug

Em builds de debug, o POS pode exibir linha opcional: `dbg: ui_state=... availability=...`.
