# Comandos para testar o fluxo POS (filmagem / validação)

Use o **Config POS** que você já tem (BASE_URL=ci.metalav.com.br, POS-LAB-01, Condomínio UUID, LAV-01, etc.).

---

## 1. Terminal 1 — Fake gateway “escutando”

No **PowerShell** (ou CMD), no repo **pagamentos**:

```powershell
cd D:\pagamentos
$env:ENV = "ci"
node scripts/fake-gateway.mjs
```

Deixe esse terminal aberto. O script fica em loop: confirma pagamentos CRIADO→PAGO e processa o ciclo quando o POS chama authorize.

**Se aparecer** `Missing IOT_HMAC_SECRET__...`: no `.env.ci.local` adicione a variável indicada com o mesmo valor do secret do gateway no backend (ex.: Vercel). Ex.: `IOT_HMAC_SECRET__POS_01=...` ou `IOT_HMAC_SECRET__GW_FAKE_001=...`.

---

## 2. Terminal 2 — Log do fluxo no notebook

No **PowerShell** (com o celular conectado por USB e depuração USB ativada):

```powershell
cd $env:LOCALAPPDATA\Android\Sdk\platform-tools
.\adb.exe logcat -s NEXUS_STATUS NEXUS_POLL_SHORT
```

Deixe rodando. Aqui você “escuta” o fluxo: requisições ao `/api/pos/status`, `ui_state`, `availability`, etc.

---

## 3. No celular (POS)

1. Abrir o app **NexusPos** (build **release** para testar com fake-gateway; ou **debug** para fluxo automático sem gateway).
2. Toque para iniciar → Escolher máquina (LAV-01 ou SEC-01) → PIX ou Crédito/Débito.
3. **Release:** aguardar alguns segundos; o fake-gateway confirma e o app mostra “Pagamento recebido! Liberando máquina…” por **2 segundos**, depois abre a tela de status.
4. **Debug:** confirm + execute-cycle são feitos pelo app; a transição pode ser rápida (sem tela “Aguardando pagamento” longa).

---

## 4. Ordem recomendada para filmar

1. Iniciar **Terminal 1** (fake-gateway).
2. Iniciar **Terminal 2** (adb logcat).
3. No celular: abrir o app e fazer o fluxo de pagamento.
4. Acompanhar no logcat as linhas `NEXUS_STATUS` / `NEXUS_POLL_SHORT` e na tela do POS a sequência: Aguardando pagamento → Pagamento recebido! Liberando máquina… (2 s) → Tela de status (Processando / Pagamento aprovado / Liberando máquina… / Máquina pronta).

---

## Ajuste feito no app (mensagem pós-pagamento)

A mensagem **“Pagamento recebido! Liberando máquina…”** estava sumindo na hora porque o app navegava para a tela de status imediatamente. Foi adicionada uma **pausa de 2 segundos** depois de detectar o pagamento confirmado, antes de chamar execute-cycle e ir para a tela de status. Assim a mensagem fica visível e o fluxo fica mais claro para filmagem e para o usuário.
