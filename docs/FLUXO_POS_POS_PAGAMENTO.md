# Fluxo POS — Depois do pagamento (PIX/cartão) e como simular para filmagem

## 1. O que o usuário vê na tela (ordem típica)

| Etapa | Onde | Mensagem / tela |
|-------|------|------------------|
| 1 | Tela de pagamento (após tocar PIX/Crédito/Débito) | **"Aguardando pagamento / Processando confirmação"** + spinner |
| 2 | Mesma tela (quando backend confirma pagamento) | **"Pagamento recebido! Liberando máquina…"** + spinner |
| 3 | Navega para tela de status | **"Processando pagamento…"** (se ainda CRIADO) ou **"Pagamento aprovado"** (PAGO) |
| 4 | Tela de status | **"Liberando máquina…"** (ciclo AGUARDANDO_LIBERACAO / LIBERADO) |
| 5 | Tela de status | **"Máquina em uso"** (ciclo EM_USO; opcional se o fake envia BUSY_ON) |
| 6 | Tela de status | **"Máquina pronta"** + **"Pressione INICIAR na lavadora/secadora para começar."** (ciclo FINALIZADO) |
| 7 | Volta sozinho ou usuário volta | **"Toque para iniciar"** (estado LIVRE; volta ao início) |

Resumo: **autorizando → pagamento confirmado → liberando ciclo → ciclo liberado (máquina pronta, clique em iniciar)**. Sim, é isso.

---

## 2. O backend tem estrutura para isso?

**Sim.** Tudo é dirigido pelo **GET /api/pos/status** (por `identificador_local` ou por `pagamento_id`).

- O backend devolve **`ui_state`** (e `availability`, `pagamento`, `ciclo`) calculados em `app/api/pos/status/route.ts` (função `parseUiState`).
- O POS (NexusPos) faz **polling** nesse endpoint e troca a mensagem conforme o `ui_state`.
- Contrato das mensagens está em **`docs/contracts/POS_STATUS_UI_STATE.md`**.

Valores de `ui_state` que a tela do POS usa:

- `AGUARDANDO_PAGAMENTO` → "Processando pagamento…"
- `PAGO` → "Pagamento aprovado"
- `LIBERANDO` → "Liberando máquina…"
- `EM_USO` → "Máquina em uso"
- `FINALIZADO` → "Máquina pronta" + "Pressione INICIAR na máquina para começar."
- `LIVRE` → "Toque para iniciar"
- (+ EXPIRADO, ERRO, ESTORNANDO, ESTORNADO)

---

## 3. Simular com fake gateway no ambiente de testes

**Sim.** No ambiente de testes (ex.: **ci.metalav.com.br**) dá para rodar o fluxo inteiro sem Stone/cartão real:

1. **Backend (API)**  
   - Deploy em CI (ex.: `https://ci.metalav.com.br`) com **`/api/dev/fake-gateway-confirm`** habilitado (já está em ambientes não-production / CI).

2. **Fake gateway (script)**  
   - No repo **pagamentos** (backend):
   ```bash
   ENV=ci node scripts/fake-gateway.mjs
   ```
   - Pré-requisitos:
     - `GW_SERIAL` cadastrado na tabela `gateways` (ex.: `GW-FAKE-001`).
     - `IOT_HMAC_SECRET__GW_FAKE_001` (ou equivalente) no `.env.ci.local` / ambiente.
   - O script:
     - Chama **POST /api/dev/fake-gateway-confirm** (HMAC) e marca um pagamento **CRIADO** → **PAGO**.
     - Faz **GET /api/iot/poll**, recebe o comando de ciclo, envia ACK + eventos (PULSO_ENVIADO, BUSY_ON, BUSY_OFF).
   - Documentação: **`docs/RUNBOOK_FAKE_GATEWAY.md`** e **`docs/NEXUS_CI_FLUXO_ARQUITETURA.md`**.

3. **POS (NexusPos)**  
   - Build de **release** (não DEBUG): após o usuário tocar em PIX/Crédito/Débito, o POS chama **authorize** → fica em "Aguardando pagamento…". O fake-gateway confirma (CRIADO → PAGO). O POS detecta PAGO, chama **execute-cycle**, mostra "Liberando máquina…" e vai para a tela de status. O fake-gateway consome o comando e envia os eventos; o backend atualiza o ciclo (LIBERADO → EM_USO → FINALIZADO). O POS mostra as mensagens conforme o `ui_state`.
   - Build **DEBUG**: o app pode fazer confirm + execute-cycle direto (sem esperar gateway), útil para testar tela de status; para simular o fluxo “real” com gateway, use release + fake-gateway.

Para **filmar para a Stone**: use **release** + **fake-gateway rodando** no mesmo ambiente (CI) que o app usa. Assim o fluxo fica: autorizar → aguardar → confirm (fake) → liberar ciclo → tela de status com todas as mensagens acima.

---

## 4. Terminal “escutando” para ver o fluxo

- **Logcat (Android)**  
  O app já emite logs com tag **`NEXUS_STATUS`** e **`NEXUS_POLL_SHORT`** com `ui_state`, `availability`, `pagamento.status`, `ciclo.status`. Para “escutar” no PC:
  ```bash
  adb logcat -s NEXUS_STATUS NEXUS_POLL_SHORT
  ```

- **Na tela do aparelho (filmagem)**  
  Em **build DEBUG**, a tela de status do POS mostra no rodapé uma linha de debug:  
  `dbg: ui_state=... availability=...`  
  Para filmar o fluxo inteiro na tela (sem depender do logcat), foi adicionado um **overlay de “flow log”** em modo DEBUG: as últimas transições de status (`ui_state`, `availability`, pagamento, ciclo) aparecem em uma faixa na parte inferior da tela de status, para você ver (e filmar) o fluxo em tempo real.

---

## 5. Resumo rápido para filmagem (Stone)

1. Ambiente: API em CI (ex.: ci.metalav.com.br); POS apontando para essa API.
2. No servidor/PC: `ENV=ci node scripts/fake-gateway.mjs` (com serial e HMAC configurados).
3. No celular: build **release** do NexusPos; configurar Condomínio e POS Serial; escolher máquina → PIX ou cartão → aguardar.
4. O fake-gateway confirma o pagamento e processa o ciclo; o POS mostra em sequência: aguardando pagamento → pagamento recebido / liberando → tela de status (pagamento aprovado → liberando máquina → máquina pronta / pressione INICIAR).
5. Para “ver” o fluxo na tela: use build **DEBUG** e veja o overlay de status na tela de status; ou use `adb logcat -s NEXUS_STATUS NEXUS_POLL_SHORT` no PC enquanto filma.

Se quiser, posso detalhar um checklist (passo a passo) só para o dia da filmagem (configuração, ordem de ligar fake-gateway vs app, etc.).
