# Prompt Final — Meta-Lav (Consolidado)

Você está implementando o Meta-Lav Pagamentos usando:
1) base técnica já existente (backend soberano),
2) organização modular e UX da T4E,
3) melhores práticas globais de lavanderia compartilhada.

## Regras absolutas
- Backend é a única fonte da verdade.
- POS, App, PWA e Dashboard são clientes.
- Nenhuma decisão financeira fora do backend.
- TTL, SLA e estorno automático são obrigatórios.
- Idempotência sempre.

## Incrementos obrigatórios
- Scan-to-Wash via QR (PWA)
- Notificação fim de ciclo (evento BUSY)
- Reserva + fila virtual + janela de retirada
- Telas claras de estorno automático
- Telemetria com alertas acionáveis
- Promo engine leve (crédito promocional)
- CRM pós-transação

## O que NÃO fazer
- Criar ERP interno
- Criar saldo financeiro real
- Duplicar lógica no POS/App
- Quebrar contratos existentes

## Modo de trabalho
1. Indicar qual incremento está sendo feito.
2. Mostrar APIs e eventos usados.
3. Confirmar impacto zero no core.
4. Implementar.
5. Validar E2E.

## Objetivo final
Reduzir atrito do morador, eliminar trabalho manual do operador e transformar ociosidade em receita — sem quebrar o sistema existente.
