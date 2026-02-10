# Meta-Lav — Estratégia Consolidada (Backend + T4E + Best Practices)

## Objetivo
Fundir de forma incremental e sem ruptura:
1. Base técnica Meta-Lav já validada (W2/W3/W4)
2. Organização/UX da proposta T4E
3. Melhores práticas globais de lavanderia compartilhada

Sem quebrar contratos existentes e mantendo backend soberano.

---

## A) Princípios finais (não negociáveis)

1. Backend Meta-Lav é soberano e única fonte da verdade.
2. Toda camada cliente (POS/App/PWA/Web) apenas consome API e eventos.
3. TTL, SLA e estorno automático permanecem obrigatórios.
4. Sem estado paralelo fora do backend.
5. Reduzir atrito do usuário.
6. Eliminar trabalho manual do operador.
7. Converter ociosidade em receita.

---

## B) Incrementos conciliados (o que entra)

### 1) Scan-to-Wash (QR sem app)
- QR na máquina/lavanderia abre PWA e fluxo canônico.
- Não altera core financeiro.

### 2) POS Sunmi com UX anti-frustração
- Mensagens claras, timers visíveis, telas de falha/retentativa/estorno.
- POS segue como cliente fino.

### 3) Estorno automático com visibilidade
- Mostrar status de compensação no POS/App/Dashboard.
- Comprovante e trilha para suporte.

### 4) Notificações inteligentes por eventos
- Fim de ciclo, retirada atrasada, reserva liberada, estorno concluído.
- Canais: push/WhatsApp/SMS (quando habilitado).

### 5) Reserva + fila virtual
- Reserva curta (TTL), “você é o próximo”, janela de retirada.

### 6) Telemetria operacional
- Alertas acionáveis: gateway offline, pulso não confirmado, BUSY travado, estorno falhou.

### 7) Promo engine leve
- Happy hour, ociosidade, cupom 1ª lavagem, fidelidade promocional.
- Crédito promocional (não saldo financeiro real).

### 8) CRM pós-transação
- Segmentação, churn, campanhas automáticas após ciclo concluído.

---

## C) Backlog conciliado

### Bloco Condomínio (experiência)
- Scan-to-Wash
- Notificação fim de ciclo
- Reserva + fila virtual
- Janela de retirada
- Tela clara de estorno automático

### Bloco Receita (gestão)
- Promo engine leve
- Dashboard de conversão por máquina
- Alertas operacionais
- CRM pós-transação
- Ação admin “resolver agora” (com role)

---

## D) Arquitetura final (adaptada)

Usuário
- POS Sunmi
- QR/PWA (Scan-to-Wash)
- App cliente

Backend Meta-Lav (soberano)
- Pagamentos / Ciclos
- TTL / SLA / Estorno automático
- Promo rules
- Eventos / Telemetria

Gateway ESP32
- execução física em máquina

Sem ruptura de contratos do core.

---

## E) Critério de evolução
Cada incremento deve:
1. declarar APIs/eventos usados
2. provar impacto zero no core canônico
3. validar E2E
4. ter rollback simples
