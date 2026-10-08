# Nota Fiscal ▸ Submeter Zeev

Cria a solicitação de pagamento de uma NFS-e no Zeev, com login SSO Microsoft e
os três anexos exigidos.

Provider: `src/providers/zeev/zeev.provider.ts` (`id: zeev`).

## Fluxo

1. **Lê o número da nota** do PDF da NFS-e (`pdftotext`, campo "Número da Nota").
2. **Obtém o comprovante de pagamento** reutilizando o `ComprovantePagamentoProvider`
   (rclone/Drive) — sem abrir o arquivo.
3. **Obtém a CND** pelo caminho resolvido no preflight (abaixo).
4. **Abre o Zeev** e autentica no SSO Microsoft.
5. **Preenche o formulário**.
6. **Anexa** NFS-e + comprovante + CND (via modal de upload do Zeev).
7. **Deixa o envio para você**: o provider não clica em "Enviar solicitação"; ele
   aguarda você revisar e clicar na janela (e detecta a saída do formulário).

## Preflight da CLI (`src/cli/prompts/zeev.prompt.ts`)

Antes de rodar o provider, a CLI resolve os dois caminhos:

| Anexo | Regra |
|---|---|
| NFS-e | mais recente de `documents/nfse/*.pdf` **do mês atual**; senão, prompt |
| CND | mais recente de `documents/cnd/*.pdf` ou `documents/certidao-negativa-debitos/*.pdf`; senão, executa o `CndProvider`; senão, prompt |

O comprovante **não** é resolvido no preflight — é baixado pelo próprio provider.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `SIPAL_MICROSOFT_EMAIL` | SSO Microsoft |
| `SIPAL_MICROSOFT_PASSWORD` | SSO Microsoft |
| `SIPAL_GESTOR_APROVADOR` | opção do select "Gestor aprovador" |
| `CNPJ` | "CNPJ favorecido" |
| `RAZAO_SOCIAL` | "Razão social" |
| `RCLONE_REMOTE` / `RCLONE_COMPROVANTE_FOLDER` | comprovante (reuso do provider) |
| `SIPAL_ZEEV_URL` | **obrigatória** — URL do request do Zeev (token `c=...`); fica só no `.env` |
| `ZEEV_HEADLESS` | `true` força headless (default: headful, para MFA) |
| `ZEEV_SUBMIT_TIMEOUT_MS` | *(opcional)* tempo de espera do envio manual (default 900000) |

## Sessão SSO

Usa um perfil persistente do Chromium em `.zeev-profile/` (gitignored). A sessão
Microsoft é reaproveitada entre execuções. O login pode aparecer **inline ou em
popup** — o provider observa todas as páginas do contexto e preenche
e-mail/senha quando as reconhece. O provider roda **headful** por padrão e
aguarda até **180s** pelo formulário (dando tempo para MFA manual).

A detecção de "formulário pronto" ancora no botão **"Enviar solicitação"**,
procurando em **todos os frames/páginas**.

## Seletores do formulário (confirmados)

O dump de `screenshots/zeev/` confirmou que o form **"Cadastrar Pagamento"** usa
**ids semânticos**. Eles estão mapeados em `FIELDS`
(`src/providers/zeev/zeev.provider.ts`), com fallback por label:

| Campo | Seletor |
|---|---|
| CNPJ Favorecido | `#inpcNPJFavorecido` |
| Razão Social | `#inprazaoSocial` |
| Encargos | `#inpencargos` (textarea) |
| Nº da NF | `#inpnnf` |
| Tipo de processo | `#inptipoDeProcesso` (select) |
| Gestor aprovador | `select[name="inp40391"]` (select, id GUID) |
| Banco | `#inpbanco` (autocomplete) |
| Agência | `#inpagencia` |
| Conta | `#inpconta` |
| Enviar | `#BtnSend` |
| Fechar tutorial | `#btnCloseTutorial` |

**Anexos**: não há `input[type=file]` no DOM. Cada anexo tem um botão
"anexar arquivo" (`ATTACH_BUTTONS`): `#btnUploadnff` (NFS-e), `#btnUploadcomptrib`
(comprovante) e `#btnUploadcnd` (CND). O botão abre um **modal** (`#dynmodal`) com
um iframe `…/files/upload`; o provider define o arquivo no input do iframe e clica
em **"Iniciar upload agora"** até o modal fechar (com fallback p/ file chooser
nativo).

**Envio manual**: o provider **não** clica em `#BtnSend`. Ele exibe "Pronto! Revise
e clique em Enviar solicitação" e aguarda (padrão 15 min, `ZEEV_SUBMIT_TIMEOUT_MS`)
até o formulário sair (mudança de URL, `#BtnSend` sumir ou mensagem de sucesso).

## Dump do DOM (diagnóstico)

O provider grava um dump em **dois casos**: sempre que `DEBUG=true`; e **em
qualquer falha da execução** (reason `failure`). Vai para
`screenshots/zeev/zeev-<reason>-<ts>.{json,html,png}` e inclui, por frame: URL,
título, todos os `input/select/textarea` (tag/type/name/id/placeholder/label e as
opções dos `select`) e todos os botões/links (texto/id/class).

## Limitações conhecidas

- "Banco" é um autocomplete: o provider digita `0260` e clica na opção contendo
  `NUBANK` (com fallback de teclado).
- O select "Gestor aprovador" usa o `name` do campo (`inp40391`) porque o id é um
  GUID; a opção é escolhida pelo texto de `SIPAL_GESTOR_APROVADOR` (exato e, se
  falhar, por substring).
- O tutorial de boas-vindas é fechado automaticamente (`#btnCloseTutorial`).
