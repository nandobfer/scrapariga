# Implementation Plan: CLI Interativo SCRAPARIGA — Menu de Contas e Documentos

**Branch**: `001-cli-interactive-menu` | **Date**: 2026-04-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-cli-interactive-menu/spec.md`

## Summary

CLI interativa Node.js/TypeScript que exibe splash screen ASCII (SCRAPARIGA), expõe um menu
navegável por setas e por número para as categorias **Contas** (luz, aluguel, condomínio) e
**Nota Fiscal** (CND, comprovante de tributos), coleta e persiste credenciais via `.env`,
executa scripts de scraping através do padrão de classe abstrata `BaseScraper` com callback
de `ProgressEvent`, e renderiza progresso em tempo real com barras/spinners de `terminal-kit`.
Esta feature entrega o shell completo da CLI + o contrato `BaseScraper` + o `DemoProvider`
funcional; os provedores reais são desenvolvidos em features posteriores.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20 LTS  
**Primary Dependencies**: terminal-kit, figlet, playwright, axios, dotenv, pino, pino-pretty,
qrcode-terminal, vitest  
**Storage**: Filesystem — `./documents/<doc-name>/YYYY-MM-DD.<ext>` para downloads;
`./sessions/<provider>.json` para Playwright storageState; `.env` para credenciais  
**Testing**: Vitest (Jest-compatible, native ESM/TypeScript, sem babel)  
**Target Platform**: Unix-like terminal com TTY interativo (Linux/macOS); Windows fora de escopo  
**Project Type**: CLI application (single-user local tool)  
**Performance Goals**: Resposta de menu < 100ms; rendering de ProgressEvent < 16ms por frame  
**Constraints**: TTY obrigatório; sem chamadas de rede em testes unitários; `.env` nunca
comitado; `any` proibido fora de fronteiras explicitamente comentadas  
**Scale/Scope**: Ferramenta local para 1 usuário; ~5–10 provedores a longo prazo

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status | Notes |
|-----------|------|--------|-------|
| I. Architecture & Design | 4 camadas (Core/Providers/Parsers/CLI) separadas; `BaseScraper` abstrata; DI para browser service | ✅ PASS | `BaseScraper` é a classe abstrata central; `BrowserService` injetado via construtor |
| I. Architecture & Design | Nenhuma lógica de scraping no CLI layer | ✅ PASS | CLI apenas roteamento + rendering; execução via `ProviderFactory` |
| II. Scraping Robustness | Retry com backoff exponencial em todas as operações de rede | ✅ PASS | `BaseScraper.retry()` compartilhado; DemoProvider valida o fluxo |
| II. Scraping Robustness | Seletores estáveis; session persistence | ✅ PASS | Playwright storageState; sem providers reais nesta feature |
| III. Code Quality | `strict: true` em tsconfig; `any` proibido; pino para logs | ✅ PASS | Config documentada em quickstart.md |
| III. Code Quality | Unit tests para Parsers; mocks de rede | ✅ PASS | DemoProvider e BaseScraper testados com Vitest; sem rede real |
| IV. Security | Credenciais via `.env`; nunca em log; `.env` em `.gitignore` | ✅ PASS | EnvService mascara campos sensíveis antes de logar |
| IV. Security | Validação de MIME/hash antes de salvar download | ✅ PASS | `BaseScraper.validateDownload()` implementado na classe base |
| V. Design Patterns | Factory para instanciar providers; Strategy para output | ✅ PASS | `ProviderFactory` + `ResultRenderer` como strategy |
| ⚠️ DEVIATION | CLI usa `terminal-kit` em vez de Commander.js/Inquirer.js (constituição) | **JUSTIFIED** | Ver Complexity Tracking — Inquirer.js não suporta cursor positioning para multi-task UI (FR-014) |

## Project Structure

### Documentation (this feature)

```text
specs/001-cli-interactive-menu/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── BaseScraper.ts   # Abstract class contract (TypeScript source)
│   └── interfaces.ts    # All supporting interfaces & types
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── index.ts                         # Entry point: splash + main menu loop
├── cli/
│   ├── menus/
│   │   ├── main.menu.ts             # Menu principal: Contas, Nota Fiscal, Sair
│   │   ├── contas.menu.ts           # Submenu: Luz, Aluguel, Condomínio, Todos, Voltar
│   │   └── nota-fiscal.menu.ts      # Submenu: CND, Comprovante, Todos, Voltar
│   └── renderer/
│       ├── splash.ts                # ASCII art (figlet) + terminal-kit colors
│       ├── progress.renderer.ts     # Multi-task fixed-section UI (FR-014)
│       └── result.renderer.ts       # Resultado: path de arquivo, QR code, dados Pix
├── core/
│   ├── browser.service.ts           # Playwright: launch/close, storageState (DI)
│   ├── env.service.ts               # dotenv read + write; credential prompt via terminal-kit
│   └── provider-factory.ts          # Factory: menu ID → instância de provider
└── providers/
    ├── base-scraper.ts              # Abstract class BaseScraper (contrato + lógica comum)
    └── demo/
        └── demo.provider.ts         # DemoProvider: 3+ etapas simuladas, sem rede

tests/
├── unit/
│   ├── providers/
│   │   └── demo.provider.spec.ts    # DemoProvider: eventos emitidos, resultado, retry
│   └── core/
│       └── env.service.spec.ts      # Leitura/escrita .env, mascaramento de credenciais
└── contract/
    └── base-scraper.contract.spec.ts # Verifica shape do contrato e Template Method
```

**Structure Decision**: Single-project (Opção 1). Uma única aplicação CLI com quatro camadas
internas (Core / Providers / Parsers / CLI) sem separação de pacotes. Parsers será populado
por features futuras quando os provedores reais forem adicionados.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| CLI usa `terminal-kit` em vez de Commander.js/Inquirer.js (constituição) | `terminal-kit` fornece `moveTo()`, `saveCursor()`, spinners, progress bars e gerenciamento de teclado em um único pacote — necessários para o layout multi-task de seções fixas (FR-014) e navegação por número sem Enter (FR-003) | Inquirer.js opera sobre readline e não permite reescrever linhas específicas do terminal sem limpar a tela inteira; Commander.js é parser de args, sem UI interativa; combinar os dois ainda não resolveria o cursor positioning do FR-014 |
