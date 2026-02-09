# CANÔNICO — META-LAV PAGAMENTOS (BACKEND FIRST, MULTI-CANAL)

Status: **regra obrigatória de arquitetura**.

## Contexto fixo
- Backend: Next.js API + Supabase
- Domínio: Pagamentos + IoT (ESP32 Gateway)
- Fonte única runtime: tabelas PT-BR (`pagamentos`, `ciclos`, `iot_commands`, `eventos_iot`, `condominio_maquinas`, `precos_ciclo`, ...)
- POS atual é canal primário
- POS é burro (sem regra de preço/liberação/compensação local)

## Premissa central
**O backend NÃO pode depender de canal (POS/App/Web/Kiosk).**

Se o backend funciona sem saber se quem chamou foi POS ou App, o design está correto.

## Regras invioláveis
1. **Identidade desacoplada de canal**
   - `channel`: `pos | mobile | web | kiosk`
   - `origin`:
     - POS -> `pos_device_id`
     - App/Web -> `user_id`

2. **Fluxo único de pagamento**
   - `availability -> price -> authorize -> confirm -> execute_cycle`

3. **Preço sempre no backend**
   - nenhum canal define/calcule promoção ou regra

4. **Concorrência prevista no domínio**
   - reserva, janela de uso, no-show, cancelamento
   - erros de estado explícitos (`409 reserved`, `410 expired`, etc.)

5. **Tudo vira evento**
   - `payment_authorized`, `payment_confirmed`, `cycle_started`, `cycle_finished`, `payment_failed`, `payment_refunded`
   - base para auditoria, histórico e dashboard

## Anti-patterns proibidos
- lógica específica de POS no core
- `if (channel === 'pos')` espalhado no domínio
- fluxo duplicado para App no futuro
- uso de tabelas EN legado no runtime

## Objetivo de engenharia
Construir backend que:
- funcione para POS hoje
- aceite App mobile amanhã sem refatorar core
- trate canal apenas como origem de chamada
