# POS Stone Pilot Checklist (20 Ciclos)

## Objetivo
Validar operação real do Nexus POS Stone com EASY Gateway em campo, com foco em estabilidade ponta a ponta:
- pagamento
- confirmação
- execução de ciclo
- liberação física

---

## Dados da sessão
- **Data:**
- **Loja (UI):**
- **POS_SERIAL:**
- **CONDOMINIO_ID (interno):**
- **Operador:**
- **Versão app POS:**
- **Ambiente API:** (prod/homolog)
- **Gateway EASY ID:**

---

## Pré-check (antes do ciclo 1)
- [ ] POS ligado e energia estável
- [ ] Internet estável (Wi-Fi/4G)
- [ ] Binding validado (`POS_SERIAL + CONDOMINIO_ID`)
- [ ] API respondendo
- [ ] EASY Gateway online
- [ ] Máquina de teste disponível
- [ ] Operador orientado no fluxo básico

---

## Registro por ciclo (1..20)

Para cada ciclo, preencher:

- **Ciclo nº:**
- **Serviço:** ( ) Lavar  ( ) Secar
- **Máquina:**
- **Método:** ( ) Pix  ( ) Débito  ( ) Crédito à vista
- **Correlation ID:**
- **Tempo total (s):**
- **Resultado:**
  - [ ] Pagamento aprovado
  - [ ] Confirm OK
  - [ ] Execute-cycle OK
  - [ ] Liberação física OK
- **Erro?** ( ) Não  ( ) Sim → código/mensagem:
- **Recuperou com retry?**
  - [ ] Não precisou
  - [ ] Sim, 1 tentativa
  - [ ] Sim, >1 tentativa
  - [ ] Não recuperou
- **Observação curta:**

---

## KPI do piloto (fechamento)
- **Total ciclos executados:**
- **Ciclos OK ponta a ponta:**
- **Ciclos com falha crítica:**
- **Taxa de sucesso (%):**
- **Tempo médio por ciclo (s):**
- **Principais erros (top 3):**
  1.
  2.
  3.

---

## Critérios GO / NO-GO

### GO (somente se todos)
- [ ] 20 ciclos concluídos
- [ ] 0 erro crítico bloqueante
- [ ] Sucesso ponta a ponta consistente
- [ ] Operador consegue usar sem suporte técnico contínuo

### NO-GO (se qualquer um)
- [ ] Falha recorrente de pagamento/execute
- [ ] Instabilidade do app em campo
- [ ] Operador depende de suporte técnico para operar

---

## Pós-piloto
- [ ] Consolidar relatório (erros + tempos + evidências)
- [ ] Abrir correções pontuais (somente bloqueantes)
- [ ] Revalidar com lote curto (5 ciclos)
- [ ] Decidir expansão para próximo terminal

---

## Nota de escopo (mandatório)
Durante o piloto POS Stone:
- não expandir para promo/fidelidade/CRM/reserva
- não adicionar nova complexidade arquitetural
- manter foco no core: pagamento + execução física + operação estável
