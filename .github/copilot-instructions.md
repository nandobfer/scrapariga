# scrapariga Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-02

## Active Technologies

- TypeScript 5.x / Node.js 20 LTS + terminal-kit, figlet, playwright, axios, dotenv, pino, pino-pretty, qrcode-terminal, file-type, vitest (001-cli-interactive-menu)

## Project Structure

```text
src/
├── index.ts                         # Entry point
├── cli/
│   ├── menus/                       # main.menu.ts, contas.menu.ts, nota-fiscal.menu.ts
│   └── renderer/                    # splash.ts, progress.renderer.ts, result.renderer.ts
├── core/                            # browser.service.ts, env.service.ts, provider-factory.ts
└── providers/
    ├── base-scraper.ts              # Abstract class (ScraperContract)
    └── demo/demo.provider.ts        # DemoProvider — no network calls

tests/
├── unit/
└── contract/
```

## Commands

npm run dev          # run CLI (tsx src/index.ts)
npm test             # vitest
npm run lint         # eslint + tsc --noEmit

## Code Style

- TypeScript strict mode (`strict: true`); `any` forbidden except at commented integration boundaries
- `BaseScraper` abstract class: providers extend it and implement only `login()`, `fetchDocuments()`, `download()`
- All shared logic (retry, session, file paths, MIME validation, progress dispatch) lives in `BaseScraper`
- `terminal-kit` for all interactive UI (menus, progress bars, spinners, prompts, cursor positioning)
- `pino` with `redact` for structured logging — `console.log` forbidden in production code
- Credentials: only via `.env` (dotenv); never hardcoded; never in logs

## Recent Changes

- 001-cli-interactive-menu: Added full stack + BaseScraper contract + DemoProvider + multi-task UI pattern

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
