# Meta-Lav Pagamentos — Resumo Executivo (W1 → W4)

1. Consolidamos arquitetura backend-first multi-canal com fonte de verdade em tabelas PT-BR de runtime.
2. Fechamos o fluxo canônico E2E: availability → price → authorize → confirm → execute-cycle.
3. Garantimos idempotência crítica:
   - confirm por `provider + provider_ref`
   - execute-cycle por `cycle + idempotency_key` com replay retornando o mesmo `command_id`.
4. Alinhamos consultas ao schema real de produção (ex.: `precos_ciclo` por `maquina_id`).
5. Implementamos guardrails e smoke checks para reduzir regressão e dependência de tabelas legado EN.
6. Introduzimos TTL para pendências (`AGUARDANDO_LIBERACAO`) com expiração automática para `ABORTADO`.
7. Bloqueamos execução tardia de ciclo expirado (`409 cycle_expired`) sem gerar novo comando IoT.
8. Entregamos compensação software-first em duas fases:
   - scan: `PAGO` não entregue → `EXPIRADO`
   - execute: `EXPIRADO` → `ESTORNADO` (simulate/real).
9. Adicionamos adapters de estorno por gateway (STONE/ASAAS) com idempotência de refund por pagamento.
10. Projeto está pronto para operação sem hardware em campo e preparado para ativação gradual em produção com rollout seguro e rollback por env.

## Próximo passo recomendado
- Ativar piloto controlado em produção (`limit` baixo), monitorar métricas de scan/execute e então escalar.
