# Investigação: status "AGUARDANDO_LIBERACAO" exibido com ciclo real FINALIZADO

**Patch aplicado:** `app/api/pos/status/route.ts` — seleção do ciclo por prioridade de status (FINALIZADO > EM_USO > LIBERADO > AGUARDANDO_LIBERACAO), desempate por `created_at` desc. Ver validação ao final.

---

## Contexto

- **Ambiente:** CI (https://ci.metalav.com.br), repo meta-lav-pagamentos, multi-tenant (tenant_id já em uso).
- **Fluxo E2E:** authorize → confirm → execute-cycle → fake-gateway (ack + evento PULSO_ENVIADO, BUSY_ON, BUSY_OFF).
- **Evidência:** No DB o ciclo do comando (ex.: 49f76dd2...) está **FINALIZADO** com timestamps corretos; em algum lugar (UI/monitor/endpoint) aparece "AGUARDANDO_LIBERACAO".

## Plano de investigação

### (1) Confirmar ciclos órfãos (AGUARDANDO_LIBERACAO) por pagamento/máquina

**Objetivo:** Ver se existem dois ou mais ciclos para o mesmo `pagamento_id` (ou mesma máquina), sendo um FINALIZADO e outro AGUARDANDO_LIBERACAO.

**Onde:** Banco Supabase (staging).

**Queries sugeridas (rodar no SQL Editor ou script):**

```sql
-- Ciclos por pagamento (último pagamento pode ser o do E2E)
SELECT id, pagamento_id, maquina_id, status, created_at, pulso_enviado_at, busy_on_at, busy_off_at
FROM public.ciclos
WHERE tenant_id = 'b5bec38d-dfec-4f33-821d-4f1c7f44db32'
  AND pagamento_id = '<payment_id_do_e2e>'
ORDER BY created_at DESC;

-- Contar pagamentos com mais de um ciclo (candidatos a “ciclo errado”)
SELECT pagamento_id, COUNT(*) AS n
FROM public.ciclos
WHERE tenant_id = 'b5bec38d-dfec-4f33-821d-4f1c7f44db32'
GROUP BY pagamento_id
HAVING COUNT(*) > 1
ORDER BY n DESC;
```

**Arquivos relacionados:** Nenhum (apenas diagnóstico). O problema é a **regra de seleção** do “ciclo atual” quando há mais de um ciclo por pagamento.

---

### (2) Identificar origem da tela/endpoint que exibe o status travado

**Candidatos (por ordem de probabilidade):**

| Fonte | Arquivo | Como escolhe o ciclo | Risco |
|-------|---------|----------------------|--------|
| **GET /api/pos/status** | `app/api/pos/status/route.ts` | Por `pagamento_id`, `order by created_at desc`, `limit 1` | **Alto:** se existir outro ciclo com `created_at` mais recente e status AGUARDANDO_LIBERACAO, esse é retornado e a UI mostra “travado”. |
| GET /api/payments/availability | `app/api/payments/availability/route.ts` | Por `maquina_id`, status em (AGUARDANDO_LIBERACAO, LIBERADO, EM_USO), `order by created_at desc`, limit 1 | Médio: mostra “reservado” se houver ciclo aberto na máquina (pode ser órfão). |
| Dashboard / Operacional | `app/api/admin/dashboard0/route.ts`, `app/operacional/ciclos/page.tsx` | Agregações por janela de tempo; não escolhe “um” ciclo por pagamento | Baixo para “tela do pagamento”, mas conta stale AGUARDANDO_LIBERACAO. |

**Conclusão:** O endpoint que determina o “ciclo atual” **por pagamento** para o fluxo POS é **GET /api/pos/status?pagamento_id=...**. A regra atual (“último por `created_at`”) é a causa provável quando há múltiplos ciclos para o mesmo pagamento.

---

### (3) Ajustar a regra de seleção do “ciclo atual”

**Regra atual (pos/status):**  
Um único ciclo por `pagamento_id`: `order by created_at desc`, `limit 1`.

**Problema:**  
Se existir ciclo A (FINALIZADO, `created_at` 10:00) e ciclo B (AGUARDANDO_LIBERACAO, `created_at` 10:01), a API retorna B e a UI mostra “AGUARDANDO_LIBERACAO”.

**Regra desejada (prioridade de negócio):**  
O “ciclo atual” do pagamento deve ser o que **mais progrediu** na máquina (o que de fato recebeu eventos), não necessariamente o mais recente por criação. Ordem sugerida:

1. **Prioridade de status:** FINALIZADO > EM_USO > LIBERADO > AGUARDANDO_LIBERACAO (qualquer outro depois).
2. **Desempate:** `created_at` descendente.

Assim, mesmo com ciclos órfãos ou duplicados, a UI mostra o estado real (ex.: FINALIZADO) em vez de um ciclo que ficou em AGUARDANDO_LIBERACAO.

**Implementação sugerida (patch mínimo):**  
Em `app/api/pos/status/route.ts`, em vez de uma query com `order by created_at desc limit 1`:

- Buscar todos os ciclos do `pagamento_id` (ex.: `limit 20`), ordenados por `created_at desc`.
- Em JS, escolher o ciclo com maior prioridade de status (FINALIZADO=4, EM_USO=3, LIBERADO=2, AGUARDANDO_LIBERACAO=1, outros=0); empate por `created_at` (já ordenado).

Mantém compatibilidade com quem consome a API (mesmo contrato de resposta) e não altera execute-cycle, availability nem dashboard.

---

## Validação após o patch

1. **curl do endpoint (CI ou local):**
   ```bash
   curl -s "https://ci.metalav.com.br/api/pos/status?pagamento_id=<PAYMENT_ID>"
   ```
   - Verificar que `ciclo.status` e `ui_state` batem com o ciclo que está FINALIZADO no DB quando há mais de um ciclo para o pagamento.

2. **E2E manual:**  
   Repetir authorize → confirm → execute-cycle → fake-gateway; após eventos, chamar GET /api/pos/status com o `pagamento_id` e conferir `ui_state: "FINALIZADO"` e `ciclo.status: "FINALIZADO"`.

3. **Query de sanidade no DB:**  
   Para o mesmo `pagamento_id`, conferir que o ciclo retornado pela API é o mesmo que tem `status = 'FINALIZADO'` e timestamps preenchidos (ou o mais avançado, se houver vários).

---

## Resumo

| Passo | Ação |
|-------|------|
| (1) | Rodar as SQLs acima para confirmar múltiplos ciclos por `pagamento_id` e órfãos AGUARDANDO_LIBERACAO. |
| (2) | Fonte do “travado”: **GET /api/pos/status** (seleção por `created_at desc`). |
| (3) | Ajuste: em **pos/status**, selecionar ciclo por **prioridade de status** (FINALIZADO primeiro) e depois `created_at desc`. |

Patch mínimo: alterar apenas `app/api/pos/status/route.ts` (lógica de escolha do ciclo + mesma resposta).

---

## Validação (curl e queries)

**1. Curl no CI (substituir `<PAYMENT_ID>` pelo id do pagamento do E2E):**
```bash
curl -s "https://ci.metalav.com.br/api/pos/status?pagamento_id=<PAYMENT_ID>"
```
Esperado após eventos: `ciclo.status` e `ui_state` iguais a `"FINALIZADO"` (não `AGUARDANDO_LIBERACAO`).

**2. SQL no Supabase (staging) — ciclos do pagamento:**
```sql
SELECT id, pagamento_id, maquina_id, status, created_at
FROM public.ciclos
WHERE tenant_id = 'b5bec38d-dfec-4f33-821d-4f1c7f44db32'
  AND pagamento_id = '<PAYMENT_ID>'
ORDER BY created_at DESC;
```
Conferir que o ciclo com `status = 'FINALIZADO'` é o que a API passa a retornar (prioridade maior que um eventual órfão AGUARDANDO_LIBERACAO).
