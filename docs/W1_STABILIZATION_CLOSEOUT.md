# W1 Stabilization Closeout — Meta-Lav Pagamentos (IoT + Guardrails)

## Objetivo
Fechar oficialmente a W1 com validação operacional e higiene do repositório após refactor de IoT/services + guardrails.

## Escopo concluído (referência)
- [x] IoT routes refatoradas para service (`poll`, `ack`, `evento`, `heartbeat`)
- [x] Dev enqueue alinhado PT-BR + guard de produção
- [x] Guardrails (`anti-legado`, `hardening`, `check`, `smoke`)
- [x] Docs: arquitetura por blocos + roadmap + canônico multi-canal

---

## Checklist de fechamento (obrigatório)

### 1) Validação IoT ponta a ponta (ambiente real/dev controlado)
- [ ] Enqueue dev cria `iot_commands` com `status=pendente` e `condominio_maquinas_id`
- [ ] Poll retorna comando e atualiza para `ENVIADO`
- [ ] Ack atualiza para `ACK`/`FALHOU` e grava `ack_at`
- [ ] Evento atualiza `eventos_iot` e transição de `ciclos` correta
- [ ] Heartbeat atualiza `gateways.last_seen_at`
- [ ] Evidências registradas (IDs/horários sem segredo)

### 2) CI mínimo com guardrails
- [ ] Pipeline executa `npm run check`
- [ ] Pipeline executa `npm run build`
- [ ] Pipeline executa `npm run smoke` (com skip explícito de e2e se faltar secret)
- [ ] Falha esperada se houver uso de tabela EN em `app/api/**`

### 3) Higiene de repositório (antes de próximos blocos)
- [ ] Revisar arquivos não rastreados estranhos (`??`)
- [ ] Remover lixo de terminal/artefatos indevidos
- [ ] Garantir que só arquivos de produto ficam no repo
- [ ] Commit de limpeza separado (se necessário)

---

## Critério de aceite da issue
- [ ] Todos os itens acima marcados
- [ ] Sem regressão funcional no fluxo atual
- [ ] Build verde após limpeza
- [ ] Repositório pronto para próxima fase (POS service/domain hardening)

---

## Próximo passo após fechamento
- Iniciar W2/W3 com foco em contrato POS backend-first multi-canal
  (`availability -> price -> authorize -> confirm -> execute_cycle`),
  sem lógica de canal no core.
