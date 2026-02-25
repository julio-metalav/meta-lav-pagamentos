# CONTEXTO DO PROJETO — use o que for relevante para a tarefa

Cole este bloco no **início da primeira mensagem** de uma nova conversa no Cursor, para o assistente recuperar o contexto rapidamente.

---

## 1. Visão geral

Dois repositórios relacionados: (1) **NexusPos** — app Android POS para lavanderia; (2) **pagamentos** — backend da API que o POS consome. Ambiente de testes: CI em https://ci.metalav.com.br. Objetivo do fluxo: usuário escolhe máquina (lavar/secar), forma de pagamento (PIX/cartão), paga, e a tela de status mostra o andamento até "Máquina pronta / Pressione INICIAR na máquina".

---

## 2. NexusPos (Android)

- **Caminho no disco:** `C:\Users\julio\AndroidStudioProjects\NexusPos`
- **Repositório:** https://github.com/julio-metalav/nexus-pos.git, branch **main**
- **Versão de referência (telas aprovadas):** commit **8d3d3b9** — mensagem: "backup: telas POS aprovadas (inicial laranja, escolha máquina com preços, pagamento botões grandes, status por ui_state)"
- **Stack:** Kotlin, Jetpack Compose, OkHttp, DataStore para config. applicationId: br.com.nexuspayments.pos
- **Arquivo principal das telas:** `app/src/main/java/br/com/metalav/nexuspos/MainActivity.kt`
- **Tema/cor:** `app/src/main/java/br/com/metalav/nexuspos/ui/theme/Color.kt` — cor laranja da logo: MetaLavOrange = Color(0xFFE85D04)

**Fluxo de telas (como está no commit 8d3d3b9):**

- **StartScreen:** Botão laranja "Toque para iniciar" (MetaLavOrange), logo META LAV embaixo; toque longo (~10 s) na logo abre Config POS; em Config o título mostra a versão (ex.: "Config POS · 2.0-telas").
- **ChooseMachineScreen:** Recebe cfg, api, onSelect: (PosMachine, Int?) -> Unit. Busca preços com api.fetchPrice(condominioId, maquinaId, "lavadora"|"secadora"). Layout: "← Voltar", título "Escolha a máquina", dois cards (SECAR em vermelho/errorContainer, LAVAR em azul/primaryContainer), altura 224.dp, espaçamento 28.dp, texto SECAR/LAVAR em displayLarge, preço em titleLarge (via formatBrasilCentavos), seta (↑/↓) 112.sp à direita (10% do card). Só permite toque quando o preço daquela máquina está carregado (secadoraPrecoCentavos/lavadoraPrecoCentavos não nulos). Ao tocar: onSelect(máquina, preçoEmCentavos).
- **ChoosePaymentScreen:** Recebe initialPriceCentavos (preço vindo da tela anterior). Não exibe valor nesta tela; se initialPriceCentavos != null, usa direto (sem "Carregando preço…"). Três botões: PIX, CRÉDITO, DÉBITO — altura 134.dp, headlineSmall, ícones 72.dp, espaçamento 43.dp, coluna a 85% da largura centralizada. LaunchedEffect com chaves estáveis (cfg?.baseUrl, cfg?.condominioId, selectedMachine?.id, selectedMachine?.tipo) e timeout 20 s para fetch de preço quando não há initialPriceCentavos.
- **KioskStatusScreen:** Poll em getPosStatusByIdentificadorLocal(posSerial, identificadorLocal) a cada 2,5 s. Exibe mensagens por ui_state: AGUARDANDO_PAGAMENTO → "Processando pagamento…", PAGO → "Pagamento aprovado", LIBERANDO → "Liberando máquina…", EM_USO → "Máquina em uso", FINALIZADO → "Máquina pronta" + "Pressione INICIAR na máquina para começar.", LIVRE/EXPIRADO/ERRO/ESTORNANDO/ESTORNADO com textos e ações correspondentes. Em DEBUG, linha no rodapé: dbg: ui_state=... availability=.... Ao detectar LIVRE (ou estado terminal), pode chamar onBack().

**Estado no fluxo (MainActivity):** selectedMachine, selectedPriceCentavos; ao ir para CHOOSE_PAYMENT passa initialPriceCentavos = selectedPriceCentavos; ao voltar zera selectedMachine e selectedPriceCentavos. Após pagamento aprovado, chama executeCycle e navega para STATUS com lastPagamentoId.

**Build / instalação:**
- Debug: `.\gradlew.bat clean assembleDebug` e depois `.\gradlew.bat installDebug` (com dispositivo conectado por USB e depuração ativada).
- APK gerado: `app\build\outputs\apk\debug\app-debug.apk`.
- Se o app antigo continuar aparecendo: desinstalar o app no celular e instalar de novo (ou instalar o APK acima manualmente).
- Na raiz do NexusPos há VERIFICACAO.txt com passos para conferir se o build novo está instalado (ex.: título "Config POS · 2.0-telas" na Config).

---

## 3. Backend (repo pagamentos)

- **Caminho no disco:** `d:\pagamentos` (é o workspace principal no Cursor)
- **Stack:** Next.js, Supabase (Postgres), API routes em app/api/
- **Endpoints principais para o POS:**
  - GET /api/pos/status — query identificador_local ou pagamento_id; retorna ui_state, availability, pagamento, ciclo, etc. Lógica de ui_state em app/api/pos/status/route.ts (função parseUiState).
  - POST /api/pos/authorize — inicia pagamento (cria registro, retorna pagamento_id).
  - Execute-cycle e confirmação conforme a integração com gateway/IoT.
- **Simulação de gateway (ambiente de testes):**
  - Script: scripts/fake-gateway.mjs.
  - Roda com: `ENV=ci node scripts/fake-gateway.mjs` (no diretório do repo pagamentos).
  - Confirma pagamentos CRIADO → PAGO via POST /api/dev/fake-gateway-confirm (só em ambientes não-production, ex.: CI).
  - Requer HMAC: no .env.ci.local (ou equivalente) definir IOT_HMAC_SECRET__<SERIAL_NORMALIZADO>, ex.: IOT_HMAC_SECRET__POS_01 ou IOT_HMAC_SECRET__GW_FAKE_001, com o mesmo valor configurado no backend (ex.: Vercel) para esse gateway.
  - O serial do gateway vem de GW_SERIAL (env ou fixture); no banco deve existir um gateway com esse serial e a máquina vinculada a ele.
- **Documentação no repo:**
  - Contrato de ui_state e mensagens: docs/contracts/POS_STATUS_UI_STATE.md
  - Fluxo pós-pagamento e simulação: docs/FLUXO_POS_POS_PAGAMENTO.md
  - Comandos para testar fluxo e filmagem: docs/COMANDOS_TESTAR_FLUXO_POS.md
  - Fake gateway: docs/RUNBOOK_FAKE_GATEWAY.md, docs/NEXUS_CI_FLUXO_ARQUITETURA.md

---

## 4. Config usada nos testes

- BASE_URL: https://ci.metalav.com.br
- POS_SERIAL: POS-LAB-01
- Condomínio (UUID): o que estiver configurado no Config do app (ex.: 35999454-0b5e-4d32-b657-a473a3d06 — conferir se o UUID está completo).
- Identificador local: LAV-01 (ou SEC-01 para secadora).
- CONDOMINIO_MAQUINAS_ID: ex.: 920a2bbb-38ba-4746-a1fe-1d929dfa447f (conforme Config POS).
- O fake-gateway deve usar o serial do gateway ao qual essa máquina está vinculada no banco (pode ser POS_01 ou outro); o secret HMAC no ambiente tem que ser o desse gateway.

---

## 5. Comandos úteis

**Build e instalar NexusPos (PowerShell):**
```
cd C:\Users\julio\AndroidStudioProjects\NexusPos
.\gradlew.bat clean assembleDebug
.\gradlew.bat installDebug
```

**Fake gateway (no repo pagamentos):**
```
cd D:\pagamentos
$env:ENV = "ci"
node scripts/fake-gateway.mjs
```

**Log do fluxo no PC (PowerShell, com celular conectado):**
```
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -s NEXUS_STATUS NEXUS_POLL_SHORT
```

---

## 6. Recuperar a versão "telas aprovadas" do NexusPos

No repositório NexusPos: `git fetch origin` e `git checkout 8d3d3b9` (ou `git reset --hard 8d3d3b9` na main se não houver mudanças locais a manter).

---

Use o que for relevante para a tarefa do novo chat; se precisar de mais detalhe em alguma parte, peça e eu busco nos arquivos e docs indicados.
