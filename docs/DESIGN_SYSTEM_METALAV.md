# Design System — Meta-Lav (Oficial)

## Paleta principal

### Primária (ação)
- Azul Meta-Lav: `#2563EB`
- Uso: botões principais, CTA, links críticos, destaque de preço.

### Sucesso
- Verde Operacional: `#16A34A`
- Uso: pagamento confirmado, máquina liberada, estorno realizado, status online.

### Atenção / Pendente
- Amarelo SLA: `#F59E0B`
- Uso: aguardando liberação, timer TTL/SLA, gateway instável.

### Erro
- Vermelho Crítico: `#DC2626`
- Uso: falha de liberação, estorno falhou, erro de pagamento.

## Base visual (dark-first)
- Fundo principal: `#0B0F17`
- Superfície/Card: `#111827`
- Borda: `#1F2937`

## Texto
- Texto principal (dark): `#E5E7EB`
- Texto secundário: `#9CA3AF`
- Texto desativado: `#6B7280`

## Neutros auxiliares
- Background light: `#F3F4F6`
- Divisores: `#374151`

---

## Estados canônicos

| Estado | Cor |
|---|---|
| Livre | `#16A34A` |
| Ocupada | `#DC2626` |
| Reservada | `#F59E0B` |
| Indisponível | `#6B7280` |
| Pago | `#2563EB` |
| Estorno pendente | `#F59E0B` |
| Estornado | `#16A34A` |
| Estorno falhou | `#DC2626` |

---

## Regras de ouro
1. Não usar cores fora desta paleta.
2. Azul somente para ação.
3. Verde somente para sucesso real.
4. Amarelo nunca finaliza fluxo.
5. Vermelho sempre exige decisão/ação.

---

## Prompt curto (Motobot)
"Design System Meta-Lav: usar paleta oficial. Azul #2563EB (ação), Verde #16A34A (sucesso), Amarelo #F59E0B (pendente), Vermelho #DC2626 (erro). Fundo #0B0F17, cards #111827, texto principal #E5E7EB. Não inventar cores fora do padrão."