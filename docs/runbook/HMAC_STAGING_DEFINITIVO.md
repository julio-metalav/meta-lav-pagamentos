# HMAC Staging — Configuração definitiva (sem fallback)

Ambiente: **https://ci.metalav.com.br**  
Workflow: **E2E Staging V2 (Finance + IoT HMAC)**  
Branch: **test/e2e-full-runner**  
Deploy: **main (Vercel Production)**

## Regra do backend

- O backend usa **apenas** `IOT_HMAC_SECRET__${SERIAL_NORMALIZADO}` (ex.: `IOT_HMAC_SECRET__GW_LAB_01`).
- **Não há fallback** para `IOT_HMAC_SECRET`. Se a env por serial não existir → **500 missing_secret** com `detail: envKey`.

---

## Etapa 2 — Gerar novo segredo

Gerar 32+ caracteres (ex.: 32 bytes em hex = 64 caracteres):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Exemplo de valor (não usar em produção; gerar o seu):  
`f6e072b047f098fae7dfdfd48caa7085f1a9e0d4e8a239ce86b1a9a41ddb6812`

Formato sugerido para identificação (opcional):  
`META_LAV_GW_LAB_01_2026_02_21_` + 32 bytes hex.

---

## Etapa 3 — GitHub Secrets

No repositório **meta-lav-pagamentos** → Settings → Secrets and variables → Actions:

| Secret | Valor |
|--------|--------|
| `STAGING_IOT_HMAC_SECRET__GW_LAB_01` | \<novo segredo gerado na Etapa 2\> |

- Não definir outro secret conflitante para o mesmo gateway.
- O workflow exporta apenas `IOT_HMAC_SECRET__GW_LAB_01` (sem `IOT_HMAC_SECRET`).

---

## Etapa 4 — Vercel Production

No projeto que serve **ci.metalav.com.br** (Production):

1. **Remover** a variável `IOT_HMAC_SECRET` (se existir).
2. **Criar ou atualizar**:
   - Nome: `IOT_HMAC_SECRET__GW_LAB_01`
   - Valor: **exatamente** o mesmo do GitHub Secret `STAGING_IOT_HMAC_SECRET__GW_LAB_01`
   - Environment: **Production**
3. **Redeploy** (Deployments → … → Redeploy) para carregar a nova env.

---

## Etapa 5 — Validação

### 5.1 Poll com curl (assinatura correta)

Serial do gateway usado no staging (ex.: `GW-LAB-01`). Normalização: maiúsculas, não-alfanuméricos → `_` → `GW_LAB_01`.

```bash
# Substituir:
# - GW_SERIAL (ex: GW-LAB-01)
# - SECRET (valor de IOT_HMAC_SECRET__GW_LAB_01)
# - GATEWAY_ID (uuid do gateway no staging)

GW_SERIAL="GW-LAB-01"
SECRET="<seu_segredo_64_hex>"
GATEWAY_ID="<uuid>"
BASE="https://ci.metalav.com.br"
TS=$(date +%s)
BODY=""
STRING_TO_SIGN="${GW_SERIAL}.${TS}.${BODY}"
SIGN=$(echo -n "$STRING_TO_SIGN" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -s -w "\n%{http_code}" \
  -H "x-gw-serial: $GW_SERIAL" \
  -H "x-gw-ts: $TS" \
  -H "x-gw-sign: $SIGN" \
  "$BASE/api/iot/poll?gateway_id=$GATEWAY_ID&limit=5"
```

- **200:** HMAC OK; body JSON com lista de comandos (pode ser `[]`).
- **401 invalid_hmac:** secret diferente entre curl e Vercel.
- **500 missing_secret:** env `IOT_HMAC_SECRET__GW_LAB_01` ausente na Vercel.

### 5.2 Rerun do workflow

- Actions → E2E Staging V2 → Run workflow (ou push em `test/e2e-full-runner`).
- Confirmar: authorize → confirm → execute-cycle → **poll 200** → ack/evento → E2E verde.
- `invalid_hmac` não deve mais aparecer.

---

## Resumo

| Onde | Variável | Valor |
|------|----------|--------|
| GitHub Secrets | `STAGING_IOT_HMAC_SECRET__GW_LAB_01` | \<segredo único\> |
| Vercel Production | `IOT_HMAC_SECRET__GW_LAB_01` | Mesmo valor do GitHub |
| CI (workflow) | `IOT_HMAC_SECRET__GW_LAB_01` | Injetado a partir do secret acima |

Um único segredo ativo por serial; backend determinístico; E2E estável.
