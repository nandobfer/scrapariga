---
description: "Task list for 001-cli-interactive-menu"
---

# Tasks: CLI Interativo SCRAPARIGA — Menu de Contas e Documentos

**Input**: Design documents from `specs/001-cli-interactive-menu/`
**Prerequisites**: plan.md ✅ · spec.md ✅ · research.md ✅ · data-model.md ✅ · contracts/ ✅ · quickstart.md ✅

**Tests**: Included — called out explicitly by spec (FR-009, US5 DemoProvider validation) and constitution (Principle III: unit tests mandatory).

**Organization**: Tasks grouped by user story. Each story is independently testable.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable with other [P]-marked tasks (different files, no incomplete dependencies)
- **[Story]**: User story this task belongs to (US1–US5)
- All paths relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the TypeScript/Node.js project and toolchain. Must complete before any source code is written.

- [X] T001 Create `package.json` and install all runtime + dev dependencies: `terminal-kit`, `figlet`, `playwright`, `axios`, `dotenv`, `pino`, `pino-pretty`, `qrcode-terminal`, `file-type`, `typescript`, `tsx`, `vitest`, `@types/*`, `eslint`
- [X] T002 [P] Create `tsconfig.json` with `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist/`, `rootDir: src/`
- [X] T003 [P] Configure `vitest.config.ts` (globals, coverage), `.eslintrc.cjs` (TypeScript rules, no-console), `.gitignore` (node_modules, dist, .env, sessions/, documents/)
- [X] T004 [P] Add npm scripts to `package.json`: `dev` (tsx src/index.ts), `build` (tsc), `test` (vitest), `test:unit` (vitest tests/unit), `test:contract` (vitest tests/contract), `test:watch` (vitest --watch), `lint` (eslint + tsc --noEmit), `typecheck` (tsc --noEmit)
- [X] T005 Create `.env.example` at repository root with all documented variables (LOG_LEVEL, NODE_ENV, DEMO_FAIL_ON) and placeholder comments for future provider credentials

**Checkpoint**: `npm install` completes without errors; `npm run typecheck` compiles an empty `src/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure all user stories depend on. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: Every subsequent task depends on T006 (interfaces) and T010 (BaseScraper).

- [X] T006 Implement `src/providers/interfaces.ts` — copy and finalize all types from `specs/001-cli-interactive-menu/contracts/interfaces.ts`: `EnvCredential`, `MenuItem`, `MenuItemType`, `ProgressEvent`, `ProgressStatus`, `ProgressCallback`, `DocumentMetadata`, `FileResult`, `PaymentResult`, `ErrorResult`, `ScraperResult`, `RetryOptions`
- [X] T007 [P] Implement `src/core/browser.service.ts` — `BrowserService` interface (newPage, close) + `PlaywrightBrowserService` class: launches Chromium via Playwright, accepts optional `StorageState` to restore session, exposes `newPage()` and `close()`
- [X] T008 [P] Implement `src/core/env.service.ts` — `EnvService` class: `get(key)` reads from `process.env`; `set(key, value)` writes atomically to `.env` (read → regex-replace or append → write to `.env.tmp` → rename); `promptMissing(credentials)` uses `terminal-kit` to interactively collect each missing value (masked input for `sensitive: true`); pino logger with `redact` — never logs raw credential values
- [X] T009 Implement `src/core/provider-factory.ts` — `ProviderFactory` class: registry map `Map<string, () => BaseScraper>`; `register(id, factory)` and `create(id)` methods; throws descriptive error for unknown provider IDs *(depends on T010 — BaseScraper type required)*
- [X] T010 Implement `src/providers/base-scraper.ts` — copy and finalize abstract class from `specs/001-cli-interactive-menu/contracts/BaseScraper.ts`: constructor(BrowserService, Logger), `run()` Template Method, `retry<T>()`, `emitProgress()`, `buildFilePath()`, `ensureDir()`, `validateDownload()`, `persistSession()`, `loadSession()`; abstract: `name`, `requiredCredentials`, `login()`, `fetchDocuments()`, `download()`

**Checkpoint**: `npm run typecheck` passes with zero errors on the foundational layer. No runtime needed.

---

## Phase 3: User Story 1 — Splash Screen e Navegação Principal (P1) 🎯 MVP Slice 1

**Goal**: `tsx src/index.ts` exibe splash ASCII e menu principal navegável; selecionar "Sair" encerra.

**Independent Test**: Executar `tsx src/index.ts` e verificar: (a) ASCII SCRAPARIGA aparece em cor, (b) menu com "Contas", "Nota Fiscal", "Sair" responde a setas e a números, (c) "Sair" encerra o processo.

### Implementation for User Story 1

- [X] T011 [P] [US1] Implement `src/cli/renderer/splash.ts` — `renderSplash()`: calls `figlet.textSync('SCRAPARIGA', { font: 'Big' })` and prints via `terminal.cyan()`; followed by a one-line subtitle in `terminal.gray()`
- [X] T012 [P] [US1] Implement `src/cli/menus/main.menu.ts` — `showMainMenu()`: uses `terminal.singleColumnMenu()` with items `[{ label: '1  Contas' }, { label: '2  Nota Fiscal' }, { label: '3  Sair' }]`; maps number keys (1–3) via `terminal.on('key')` to immediate selection; returns selected `MenuItemType` or `providerId`
- [X] T013 [US1] Implement `src/index.ts` — entry point: `renderSplash()` → `while(true)` loop calling `showMainMenu()` → dispatch to submenu or `process.exit(0)` on "Sair"; configure pino logger with pino-pretty when `NODE_ENV !== 'production'`

**Checkpoint**: `tsx src/index.ts` → ASCII splash → menu renders → arrows and number keys work → "Sair" exits cleanly.

---

## Phase 4: User Story 4 — Execução de Script com Progresso Visual (P1) 🎯 MVP Slice 2

**Goal**: Renderer de progresso (multi-task fixed sections) e renderer de resultado (arquivo, QR code, Pix) implementados e funcionais com dados de teste.

**Independent Test**: Invocar `ProgressRenderer` e `ResultRenderer` diretamente com dados mock; verificar renderização de spinners, ✅/❌/⚠️, QR code e exibição de path de arquivo.

### Implementation for User Story 4

- [X] T014 [US4] Implement `src/cli/renderer/progress.renderer.ts` — `ProgressRenderer` class: `init(providerNames: string[])` reserva N linhas fixas no terminal (uma por provider) usando `terminal.saveCursor()` + espaços; `update(providerName, event: ProgressEvent)` usa `terminal.moveTo(row, col)` para sobrescrever a linha correspondente com o emoji de status + rótulo + spinner ou barra terminal-kit; `done(providerName)` marca a seção como concluída; `dispose()` restaura cursor e imprime separador
- [X] T015 [P] [US4] Implement `src/cli/renderer/result.renderer.ts` — `ResultRenderer`: `render(result: ScraperResult)` — `FileResult`: imprime ✅ + path em verde; `PaymentResult`: imprime valor formatado (em reais, não centavos), código Pix em caixa destacada, QR Code via `qrcode-terminal`; `ErrorResult`: imprime ❌ em vermelho com mensagem; seguido de `terminal('\nPressione qualquer tecla para continuar...')` + `await terminal.waitForEvent('key')`
- [X] T016 [US4] Implement `src/cli/renderer/retry.prompt.ts` — `promptRetry()`: after max retries exhausted, `terminal.yesOrNo({ yes: ['y', 's'], no: ['n'] })` → returns boolean; displayed with ❌ context and attempt count

**Checkpoint**: `ProgressRenderer` e `ResultRenderer` renderizam corretamente com dados hardcoded em um arquivo de teste manual (`tsx tests/manual/renderer.test.ts`).

---

## Phase 5: User Story 5 — DemoProvider para Validação da UI (P1) 🎯 MVP Slice 3

**Goal**: `DemoProvider` completo; todas as peças do MVP conectadas; testes passando.

**Independent Test**: Selecionar "Demo" no menu → execução completa com 4 etapas simuladas → resultado exibido → retorno ao menu principal. `npm test` passa.

### Tests for User Story 5

- [X] T017 [P] [US5] Write `tests/contract/base-scraper.contract.spec.ts` — verifica que `DemoProvider` (a) é instanciável, (b) tem `name` e `requiredCredentials` definidos, (c) `run()` chama `login → fetchDocuments → download` na ordem correta usando vi.spyOn, (d) `emitProgress` é chamado para cada etapa, (e) resultado retornado tem `type === 'file'`
- [X] T018 [P] [US5] Write `tests/unit/providers/demo.provider.spec.ts` — testa: (a) execução normal emite ProgressEvents com status correto para cada etapa, (b) `DEMO_FAIL_ON=download` faz `download()` lançar Error, (c) mock de `BrowserService` é usado (sem Playwright real), (d) `ScraperResult` retornado é `FileResult` com path no formato esperado
- [X] T019 [P] [US5] Write `tests/unit/core/env.service.spec.ts` — testa: (a) `get()` retorna valor de `process.env`, (b) `set()` escreve nova chave em `.env` de teste, (c) `set()` atualiza chave existente sem duplicar, (d) valores sensíveis nunca aparecem em logger output (spy no pino)

### Implementation for User Story 5

- [X] T020 [US5] Implement `src/providers/demo/demo.provider.ts` — `DemoProvider extends BaseScraper`: `name = 'demo'`, `requiredCredentials = []`; `login()`: delay 1500ms + emite ProgressEvent login/pending → login/success; `fetchDocuments()`: delay 1000ms + emite fetch/pending → fetch/success, returns 1 `DocumentMetadata`; `download()`: delay 2000ms + emite download/pending → download/success (se `DEMO_FAIL_ON !== 'download'`) ou lança Error; retorna `FileResult` com `buildFilePath('demo', 'pdf')`
- [X] T021 [US5] Register `DemoProvider` in `src/core/provider-factory.ts` and add "Demo" entry to `src/cli/menus/main.menu.ts` (visible only when `NODE_ENV !== 'production'`); wire full execution flow in `src/index.ts` (select provider → `EnvService.promptMissing()` → `ProgressRenderer.init()` → `provider.run()` via `ProgressCallback` → `ResultRenderer.render()` → `promptRetry()` if needed → back to menu)

**Checkpoint**: `npm test` — all tests pass. `tsx src/index.ts` → Demo → 3 animated steps visible (login, fetchDocuments, download) → FileResult displayed → any key → back to main menu.

---

## Phase 6: User Story 2 — Submenu de Contas com Coleta de Credenciais (P2)

**Goal**: Submenu de Contas completo com Luz, Aluguel, Condomínio, Todos, Voltar; coleta de credenciais funcional.

**Independent Test**: Selecionar "Contas" no menu → submenu aparece → "Voltar" retorna ao main menu → selecionar provedor com credenciais ausentes aciona o prompt → credenciais salvas no `.env`.

### Implementation for User Story 2

- [X] T022 [US2] Implement `src/cli/menus/contas.menu.ts` — `showContasMenu()`: `terminal.singleColumnMenu()` com itens `['1  Conta de Luz', '2  Aluguel', '3  Condomínio', '4  Todos', '5  Voltar']`; number-key shortcuts (1–5); returns `{ action: 'provider' | 'all' | 'back', providerIds: string[] }`
- [X] T023 [US2] Wire `contas.menu.ts` into `src/index.ts` main loop: "Contas" → `showContasMenu()` → if back return to main; if provider → `EnvService.promptMissing(provider.requiredCredentials)` → execute with `ProgressRenderer` + `ResultRenderer`; if "Todos" → `ProgressRenderer.init([all provider names])` → sequential execution: each provider run wrapped in try/catch — on error mark its section ❌, collect to `errors[]`, continue loop — after all runs: if `errors.length > 0`, render error summary; remaining providers always execute regardless of previous failures

**Checkpoint**: Fluxo completo Contas → Luz/Aluguel/Condomínio sem credenciais no `.env` → prompt aparece → `.env` atualizado → DemoProvider executa como stub → resultado exibido → back to menu.

---

## Phase 7: User Story 3 — Submenu de Nota Fiscal com Coleta de Credenciais (P2)

**Goal**: Submenu de Nota Fiscal com CND, Comprovante, Todos, Voltar — mesmo padrão de comportamento que US2.

**Independent Test**: Selecionar "Nota Fiscal" → submenu → Voltar funciona → CND aciona credential prompt → execução completa.

### Implementation for User Story 3

- [X] T024 [P] [US3] Implement `src/cli/menus/nota-fiscal.menu.ts` — `showNotaFiscalMenu()`: itens `['1  CND', '2  Comprovante de Pagamento', '3  Todos', '4  Voltar']`; same pattern as `contas.menu.ts`
- [X] T025 [US3] Wire `nota-fiscal.menu.ts` into `src/index.ts` main loop — same execution pattern as US2: credential check → ProgressRenderer → run → ResultRenderer → retry prompt → back to menu; for "Todos": each provider wrapped in try/catch — on error mark section ❌, collect to `errors[]`, continue — render error summary after all runs complete

**Checkpoint**: Fluxo completo Nota Fiscal → CND/Comprovante → coleta de credenciais → execução → resultado → back to menu.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Validação final, type safety, e qualidade geral.

- [X] T026 Run `npm test` and ensure all tests pass with zero failures and zero TypeScript errors
- [X] T027 [P] Run `npm run typecheck` (`tsc --noEmit`) and resolve all type errors until exit code is 0
- [X] T028 [P] Run `npm run lint` and fix all ESLint violations (especially `no-console` — replace any remaining `console.log` with `logger.*`)
- [X] T029 End-to-end smoke test: `tsx src/index.ts` → navigate all menus → Demo full run → retry with `DEMO_FAIL_ON=download` → verify 3 retries + prompt → verify `.env` write from credential prompt

**Checkpoint**: All 4 validation commands pass. Application is fully functional.

---

## Dependencies

```
Phase 1 (Setup)
  └── Phase 2 (Foundational)
        T006 (interfaces) → T007, T008, T009, T010 (all depend on interfaces)
        T010 (BaseScraper) → T009 (ProviderFactory needs BaseScraper type)
        └── Phase 3 (US1): T011, T012 [P] → T013
              └── Phase 4 (US4): T014 → T015, T016 [P]
                    └── Phase 5 (US5): T017, T018, T019 [P] → T020 → T021
                          └── Phase 6 (US2): T022 → T023
                          └── Phase 7 (US3): T024 [P] → T025
                                └── Phase 8 (Polish): T026, T027, T028 → T029
```

**Parallel opportunities within phases**:
- Phase 1: T002, T003, T004, T005 all [P] after T001
- Phase 2: T007, T008, T009 all [P] after T006
- Phase 3: T011, T012 [P] before T013
- Phase 4: T015, T016 [P] with or after T014
- Phase 5: T017, T018, T019 [P] (tests) before T020; T024 [P] with T022

---

## Implementation Strategy

**MVP scope** (minimum demonstrable value): **Phases 1–5** (T001–T021).
- At end of Phase 5: `tsx src/index.ts` launches, shows ASCII splash, navigates menus, executes DemoProvider with full visual progress (animated bars, emojis, retry cycle), displays result, returns to menu. All tests pass.
- No real scraping providers needed; the architecture is proven and extensible.

**Incremental delivery**:
1. Phase 1–2: Invisible infrastructure — verifiable via `npm run typecheck`
2. Phase 3: First visible output — splash + menu loop
3. Phase 4: Progress engine — visual feedback system
4. Phase 5: End-to-end demo — full feature validated without external dependencies
5. Phase 6–7: Real menu categories — identical pattern, just new menu files
6. Phase 8: Polish + validation gate

**Adding a new provider (post-feature)**:
1. Create `src/providers/<name>/<name>.provider.ts` extending `BaseScraper`
2. Register in `provider-factory.ts`
3. Add entry to appropriate menu file (contas or nota-fiscal)
4. Write `tests/unit/providers/<name>.provider.spec.ts`
— No changes to BaseScraper, renderers, or CLI infrastructure required.
