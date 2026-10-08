# CND — Certidão Negativa de Débitos (Receita Federal)

Provider `cnd` — `src/providers/cnd/cnd.provider.ts`

## O problema

O serviço <https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj> é
protegido por um **hCaptcha invisível validado no servidor** da Receita:

- o front chama `POST /servico/certidoes/api/consulta/validar-contribuinte`
  (e `/api/Emissao/verificar`) com o header `X-Captcha-Token`;
- o backend valida o token e devolve
  `{"statusValidacao":"CaptchaFalhaValidacao","codigo":"023"}` quando ele não passa.

Qualquer navegador automatizado (Chromium/Chrome do Playwright — headless, headed,
com `navigator.webdriver` escondido, locale pt-BR, até com um humano resolvendo o
desafio) tem o token **rejeitado**. O Chrome normal do usuário passa.

## A solução: fluxo assistido pelo Chrome do Windows

Sob WSL, o provider dirige o **Chrome real do Windows** via DevTools Protocol (CDP):

```
CndProvider.run()
  ├─ resolveWindowsPaths()      detecta WSL + Chrome/Node do Windows + %TEMP%
  ├─ installHelper()            copia scripts/cnd-helper.mjs p/ %TEMP%\scrapariga-cnd
  ├─ launchWindowsChrome()      Start-Process chrome.exe --remote-debugging-port=N
  ├─ runHelper()                node.exe cnd-helper.mjs   (cwd = /mnt/c/...)
  │     ├─ CDP: preenche o CNPJ (eventos de teclado reais — o campo tem máscara)
  │     ├─ clica "Consultar Certidão"  → captcha invisível (normalmente passa só)
  │     ├─ clica "Consultar Certidão" na tela de período
  │     └─ clica "Segunda via" → captura o PDF (resposta de /consulta/seg-via)
  ├─ readWindowsFile()          lê o PDF (wslpath -u)
  └─ salva em documents/certidao-negativa-debitos/YYYY-MM-DD.pdf
```

Em ambientes sem Windows (ou `CND_MANUAL=true`), o provider degrada para o
comportamento antigo: copia o CNPJ para a área de transferência e devolve um
`ManualResult` com o link.

### Detalhes que importam

- **`scripts/cnd-helper.mjs`** é Node puro (só `fetch`/`WebSocket` nativos, sem
  dependências). Roda no `node.exe` do Windows.
- **Sem `cmd.exe`**: o `cmd` inicia com um cwd UNC (`\\wsl.localhost\...`) e
  rejeita `cd /d`. Falamos direto com `node.exe` e passamos `cwd = /mnt/c/...`
  (que o Windows enxerga como `C:\...`).
- **Máscara do CNPJ**: o valor precisa ser **digitado** via
  `Input.dispatchKeyEvent`; atribuir `.value` não aciona o Angular.
- **Captcha**: normalmente passa sozinho no Chrome real. Se aparecer um desafio,
  o usuário precisa resolvê-lo na janela (o helper aguarda).
- **Erros da Receita**: `023` = captcha; `033` = instabilidade/rate-limit
  (transitório). O helper lê o banner e devolve o código.

### Variáveis de ambiente

| Variável | Papel |
| --- | --- |
| `CND_MANUAL=true` | Força o fluxo manual (copia CNPJ + link). |
| `CND_CAPTCHA_TIMEOUT_MS` | Tempo máximo aguardando o resultado/captcha (padrão 300000). |

### Como testar manualmente

```bash
npx tsx scripts/test-cnd-provider.ts
```
