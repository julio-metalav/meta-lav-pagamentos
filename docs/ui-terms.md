# UI Terms Dictionary — Meta-Lav Pagamentos

## Objetivo
Padronizar linguagem de produto na interface sem quebrar compatibilidade técnica.

---

## Regra principal
- **UI (texto para usuário):** usar **Loja**
- **Técnico interno (DB/API/código legado):** manter `condominio_id` e recursos relacionados

> Em resumo: **Loja por fora, condominio_id por dentro**.

---

## Mapeamento oficial

| UI (exibir) | Técnico (interno) |
|---|---|
| Loja | `condominio_id` |
| Lojas | `condominios` (tabela/rotas existentes) |
| Selecione a loja | `select` que popula `condominio_id` |
| Todas as lojas | filtro sem `condominio_id` |

---

## Exemplos práticos

### 1) Formulário
- Label UI: `Loja`
- Campo payload: `{ condominio_id: "..." }`

### 2) Filtro
- UI: `Todas as lojas`
- Query interna: `?condominio_id=<uuid>` quando selecionado

### 3) Tabela
- Coluna UI: `Loja`
- Valor exibido: `nome` da entidade em `condominios`

---

## Do / Don’t

### Do ✅
- Escrever textos de tela com **Loja**/**Lojas**
- Manter compatibilidade técnica com `condominio_id`
- Em novos componentes, mapear nome amigável (UI) para nome técnico (payload)

### Don’t ❌
- Exibir `condominio_id` para usuário final (exceto debug técnico)
- Renomear tabela/coluna para `loja_*` sem plano de migração
- Misturar termos na mesma tela (ex.: título "Loja" e botão "Condomínio")

---

## Escopo da política
Esta política vale para:
- Admin
- Dashboard operacional
- Fluxos POS
- Mensagens de feedback/erro ao usuário

Não altera automaticamente:
- Schema do banco
- Contratos existentes de API
- Integrações externas já em produção

---

## Evolução futura (Opcional)
Quando houver janela de mudança com baixo risco:
1) adicionar alias de API (`loja_id` ↔ `condominio_id`)
2) versionar contratos
3) migrar interno gradualmente com rollback planejado

Até lá: manter padrão **UI Loja / Interno condominio_id**.
