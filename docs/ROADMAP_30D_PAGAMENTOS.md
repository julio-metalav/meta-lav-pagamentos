# ROADMAP 30 DIAS — META-LAV PAGAMENTOS

Objetivo: estabilizar o core de pagamentos + IoT, blindar contra regressões e preparar escala sem quebrar produção.

## Regras Operacionais (válidas para todo o roadmap)
- 1 mudança por vez, 1 commit por bloco.
- Sempre rodar `npm run build` após cada commit.
- Sempre mostrar `git status --short` + `git diff --stat` antes de commit.
- Push/deploy/migração SQL somente com autorização explícita (`EXECUTAR:`).
- Não imprimir segredos (tokens/keys), mesmo em logs.

---

## Semana 1 (W1) — Estabilização do Core (DB + IoT + Rotas)

### Meta
Fechar núcleo técnico confiável com rotas finas e regras centralizadas.

### Entregáveis da semana
- [ ] PASSO 3 concluído: `lib/iot/service.ts` centraliza `poll/ack/evento`.
- [ ] PASSO 4 concluído: `lib/dev/enqueue.ts` alinhado ao runtime PT-BR.
- [ ] Rotas `/api/iot/*` com responsabilidade mínima (parse/validate/chamada service).
- [ ] Status de comandos e ciclos padronizados e documentados.
- [ ] `npm run build` verde ao final da semana.

### Backlog executável (ordem)
1. [ ] Mapear lógica atual de `app/api/iot/poll|ack|evento` e extrair para service sem mudar comportamento.
2. [ ] Criar contratos de entrada/saída no service (tipos TS simples).
3. [ ] Ajustar rotas para chamar service e retornar JSON padronizado.
4. [ ] Alinhar `dev/enqueue` para `iot_commands` + `condominio_maquinas_id` + guard produção.
5. [ ] Validar fluxo completo manual: `enqueue -> poll -> ack/evento -> ciclo`.

### Critério de aceite W1
- [ ] Nenhuma regressão funcional no fluxo atual.
- [ ] Build verde.
- [ ] Logs úteis sem vazamento de segredo.

---

## Semana 2 (W2) — Guardrails Anti-Quebra

### Meta
Impedir regressões por automação (anti-legado + hardening + smoke).

### Entregáveis da semana
- [ ] `scripts/anti-legado.js` criado e ligado em `npm run check`.
- [ ] `scripts/hardening.js` criado (rotas API sem JSX/use client e dependências corretas).
- [ ] `scripts/smoke.sh` (ou `.ps1`) criado para build + introspect + e2e-iot.
- [ ] `npm run check` e `npm run smoke` executando localmente.

### Backlog executável (ordem)
1. [ ] Definir lista proibida de tabelas EN em runtime (`sales`, `payments`, `machines`, etc.).
2. [ ] Implementar varredura em `app/api/**` e falha explícita no `anti-legado`.
3. [ ] Implementar `hardening` com validações estruturais mínimas.
4. [ ] Consolidar scripts no `package.json`:
   - [ ] `check`
   - [ ] `smoke`
5. [ ] Rodar e ajustar até zero falso positivo relevante.

### Critério de aceite W2
- [ ] Qualquer uso de tabela legado EN em rota runtime quebra `check`.
- [ ] `smoke` roda ponta a ponta com resultado claro.

---

## Semana 3 (W3) — POS Nativo Integrado ao Core (Módulo 1)

### Meta
POS operacional com backend mandando em preço/liberação/status.

### Entregáveis da semana
- [ ] Contrato API POS fechado (start/disponibilidade/preço/authorize/confirm).
- [ ] Fluxo E2E validado: seleção -> pagamento -> comando -> execução.
- [ ] Mensagens de erro simples para operador (sem detalhes técnicos).
- [ ] Rastreabilidade por transação (trace id / correlation id).

### Backlog executável (ordem)
1. [ ] Definir contrato canônico de payloads POS.
2. [ ] Garantir que POS não contenha lógica de negócio (somente interface + SDK).
3. [ ] Consolidar `authorize` no serviço de domínio POS.
4. [ ] Validar cenários de falha (gateway offline, comando sem ACK, timeout).
5. [ ] Homologar fluxo mínimo em ambiente de teste real.

### Critério de aceite W3
- [ ] POS conclui ciclo sem regra local sensível.
- [ ] Backend é fonte única para preço, permissão e liberação.

---

## Semana 4 (W4) — Dashboard Base + Operação Assistida (Módulo 4)

### Meta
Dar visibilidade operacional e reduzir tempo de resposta a incidentes.

### Entregáveis da semana
- [ ] Painel com saúde de gateways + fila de comandos + ciclos travados.
- [ ] Relatório bruto de vendas por condomínio/método/período.
- [ ] Alertas operacionais mínimos definidos.
- [ ] Runbook de incidente curto publicado.

### Backlog executável (ordem)
1. [ ] Definir métricas operacionais prioritárias.
2. [ ] Construir endpoints de leitura para dashboard base.
3. [ ] Implementar UI mínima com filtros por condomínio/período.
4. [ ] Criar alertas de exceção (gateway offline, comando preso, ciclo órfão).
5. [ ] Publicar `docs/RUNBOOK_OPERACIONAL.md`.

### Critério de aceite W4
- [ ] Operação consegue identificar e agir em incidente em < 15 min.
- [ ] Dashboard cobre saúde + receita bruta + fila IoT.

---

## KPIs de 30 dias
- [ ] Build verde > 95% das execuções locais.
- [ ] Falhas de comando sem desfecho < 2%.
- [ ] Tempo médio de diagnóstico < 15 min.
- [ ] 0 uso de tabela EN em rotas runtime (via `check`).

---

## Comandos-padrão da rotina técnica
```bash
git status --short
git diff --stat
npm run build
npm run check
npm run smoke
```

## Nota de escopo
- Tabelas PT-BR runtime são fonte única (`iot_commands`, `eventos_iot`, `gateways`, `condominio_maquinas`, `pagamentos`, `ciclos`, `precos_ciclo`).
- Tabelas EN ficam somente como legado/read-only (fora da lógica runtime).
- PWA fora deste ciclo de 30 dias.
