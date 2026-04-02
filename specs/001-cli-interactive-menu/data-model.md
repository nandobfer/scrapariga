# Data Model: CLI Interativo SCRAPARIGA

**Branch**: `001-cli-interactive-menu` | **Date**: 2026-04-02

---

## Entities

### EnvCredential

Descreve uma variável de ambiente necessária para um provider. Declarada pelo provider,
consumida pelo `EnvService` para verificação e coleta interativa.

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Nome da variável de ambiente (ex: `ENEL_USER`) |
| `label` | `string` | Rótulo exibido no prompt interativo (ex: `"Usuário da Enel"`) |
| `description` | `string` | Descrição auxiliar exibida abaixo do rótulo |
| `sensitive` | `boolean` | `true` → mascarar input com `*`; valor nunca aparece em logs |

**Validation rules**:
- `key` deve seguir `[A-Z_][A-Z0-9_]*` — variável de ambiente válida.
- `sensitive: true` obriga `EnvService` a usar redact no logger antes de qualquer log.

---

### MenuItem

Entrada em um menu interativo. Cada item pode referenciar um provider ou ser uma ação
especial (Sair, Voltar, Todos).

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Texto exibido no menu |
| `type` | `'provider' \| 'all' \| 'back' \| 'exit'` | Tipo de ação |
| `providerId` | `string \| undefined` | ID do provider (quando `type === 'provider'`) |
| `children` | `MenuItem[] \| undefined` | Itens filhos para submenus |

**Validation rules**:
- Quando `type === 'provider'`, `providerId` DEVE estar presente e registrado no `ProviderFactory`.
- `type === 'all'` expande todos os irmãos com `type === 'provider'` no mesmo submenu.

---

### ProgressEvent

Emitido pelo provider durante a execução via `ProgressCallback`. A CLI consome cada evento
para atualizar a seção visual correspondente.

| Field | Type | Description |
|-------|------|-------------|
| `stepId` | `string` | Identificador único da etapa (ex: `'login'`, `'fetch'`, `'download'`) |
| `label` | `string` | Mensagem descritiva exibida na barra (ex: `"Autenticando..."`) |
| `status` | `ProgressStatus` | Estado atual desta etapa |
| `attempt` | `number \| undefined` | Número da tentativa atual (para retry; começa em 1) |
| `maxAttempts` | `number \| undefined` | Total de tentativas permitidas (para exibir "2/3") |

**ProgressStatus**:
```
'pending'    → spinner animado (etapa iniciada, aguardando)
'success'    → ✅ verde (etapa concluída com sucesso)
'warning'    → ⚠️ amarelo (concluída com ressalva)
'error'      → ❌ vermelho (etapa falhou; retry em andamento ou esgotado)
```

---

### ScraperResult

Resultado final retornado pelo método `download()` de um provider, consumido pelo
`ResultRenderer` da CLI.

**Discriminated union** por `type`:

#### FileResult
| Field | Type | Description |
|-------|------|-------------|
| `type` | `'file'` | Discriminant |
| `filePath` | `string` | Caminho absoluto do arquivo baixado |
| `mimeType` | `string` | MIME validado (ex: `'application/pdf'`) |
| `sizeBytes` | `number` | Tamanho do arquivo em bytes |

#### PaymentResult
| Field | Type | Description |
|-------|------|-------------|
| `type` | `'payment'` | Discriminant |
| `pixCode` | `string` | Código Pix copia-e-cola |
| `pixQrData` | `string` | Payload para gerar o QR Code |
| `amount` | `number` | Valor a pagar em centavos (para evitar float imprecision) |
| `dueDate` | `string \| undefined` | Data de vencimento no formato `YYYY-MM-DD` |

#### ErrorResult
| Field | Type | Description |
|-------|------|-------------|
| `type` | `'error'` | Discriminant |
| `message` | `string` | Mensagem de erro legível |
| `cause` | `unknown \| undefined` | Erro original da camada de rede/browser |

---

### DocumentMetadata

Metadado de um documento encontrado pelo provider durante `fetchDocuments()`. Usado como
argumento para `download()`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Identificador único do documento no site alvo |
| `name` | `string` | Nome legível (usado para nomear o subdiretório em `./documents/`) |
| `url` | `string \| undefined` | URL direta de download se disponível; pode ser `undefined` se o download exigir interação |
| `mimeHint` | `string \| undefined` | MIME esperado para validação antecipada (ex: `'application/pdf'`) |

---

### RetryOptions

Opções para `BaseScraper.retry()`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Número máximo de tentativas |
| `baseDelayMs` | `number` | `1000` | Delay base em ms; dobra a cada tentativa (1s → 2s → 4s) |
| `onAttempt` | `(attempt: number, error: Error) => void` | `undefined` | Callback chamado antes de cada retry; usado para emitir ProgressEvent de tentativa |

---

## Class Hierarchy

```
BaseScraper  (abstract class — src/providers/base-scraper.ts)
│
│  ── Constituição ──────────────────────────────────────────────────────────
│  Camada Providers: cada site = 1 classe que estende BaseScraper
│  DI: BrowserService injetado via construtor
│  Template Method: run() define o algoritmo; providers implementam os steps
│  ────────────────────────────────────────────────────────────────────────
│
├── Propriedades compartilhadas (injetadas via construtor)
│   ├── protected browserService: BrowserService
│   └── protected logger: Logger  (pino)
│
├── Métodos NÃO sobrescritos (lógica compartilhada)
│   ├── run(credentials, onProgress): Promise<ScraperResult>
│   │     → Template Method: login → fetchDocuments → download (cada um com retry)
│   ├── retry<T>(fn, opts): Promise<T>
│   │     → Exponential backoff; chama opts.onAttempt() para emitir ProgressEvent
│   ├── emitProgress(cb, event): void
│   │     → Normaliza e despacha ProgressEvent para o renderer da CLI
│   ├── buildFilePath(docName, ext): string
│   │     → Retorna ./documents/<docName>/YYYY-MM-DD.<ext>
│   ├── ensureDir(subDir): Promise<string>
│   │     → Cria ./documents/<subDir>/ se não existir
│   ├── validateDownload(tmpPath, allowedMimes): Promise<void>
│   │     → Verifica MIME com file-type; deleta tmp e lança erro se inválido
│   ├── persistSession(ctx: BrowserContext): Promise<void>
│   │     → Salva storageState em ./sessions/<name>.json
│   └── loadSession(): Promise<StorageState | undefined>
│         → Lê ./sessions/<name>.json se existir
│
├── Propriedades ABSTRATAS (declaradas pelo provider)
│   ├── abstract readonly name: string
│   │     → ID único do provider (ex: 'enel', 'demo'); usado em paths de sessão e docs
│   └── abstract readonly requiredCredentials: EnvCredential[]
│         → Lista de variáveis de ambiente necessárias para este provider
│
└── Métodos ABSTRATOS (implementados pelo provider)
    ├── abstract login(page: Page, credentials: Record<string, string>): Promise<void>
    │     → Navegar ao site e autenticar com as credenciais fornecidas
    ├── abstract fetchDocuments(page: Page): Promise<DocumentMetadata[]>
    │     → Encontrar e listar os documentos disponíveis para download
    └── abstract download(page: Page, doc: DocumentMetadata): Promise<ScraperResult>
          → Baixar o documento e retornar FileResult ou PaymentResult

DemoProvider extends BaseScraper  (src/providers/demo/demo.provider.ts)
│   name = 'demo'
│   requiredCredentials = []
│   login()          → delay 1.5s + emite ProgressEvent 'login/success'
│   fetchDocuments() → delay 1.0s + emite ProgressEvent 'fetch/success'
│   download()       → delay 2.0s + emite ProgressEvent 'download/success'
│                      se DEMO_FAIL_ON=download → lança Error (para testar retry)
└── ScraperResult: FileResult { filePath: './documents/demo/YYYY-MM-DD.pdf', ... }
```

---

## State Transitions: ProgressStatus per Step

```
             start()
               │
               ▼
          ┌─────────┐
          │ pending │ ◄──────────────────────┐
          └────┬────┘                        │
               │ done                        │ retry (attempt < max)
        ┌──────┴──────┐                      │
        ▼             ▼                      │
   ┌─────────┐   ┌─────────┐           ┌─────────┐
   │ success │   │  error  │ ──────────► error   │
   └─────────┘   └────┬────┘           └─────────┘
                      │ max attempts exceeded
                      ▼
               ┌─────────────────────────────────┐
               │  CLI: "Tentar novamente? (s/n)"  │
               └──────────────┬──────────────────┘
                    s ◄────────┤────────► n
                    │                    │
              volta ao início      retorna ao menu
```

---

## File Path Convention

```
./documents/
└── <DocumentMetadata.name slugificado>/
    └── YYYY-MM-DD.<ext>        ← sobrescreve se já existe (warn em log)

./sessions/
└── <BaseScraper.name>.json     ← Playwright storageState
```

**Slug rule**: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`  
Exemplo: `"Fatura ENEL Agosto"` → `"fatura-enel-agosto"`
