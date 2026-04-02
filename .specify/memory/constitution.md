<!--
SYNC IMPACT REPORT
==================
Version change:    [CONSTITUTION_VERSION] → 1.0.0 (MAJOR: Initial ratification — all placeholders replaced)
Modified sections: none (first ratification)
Added principles:
  - I.   Architecture & Design (OOP & Modules)
  - II.  Scraping Robustness
  - III. Code Quality & Testing (NON-NEGOTIABLE)
  - IV.  Security & Privacy (NON-NEGOTIABLE)
  - V.   Design Patterns
Added sections:
  - Technology Stack
  - Development Workflow
Removed sections:  none
Templates reviewed:
  - .specify/templates/plan-template.md  ✅ no changes required (Constitution Check is generic)
  - .specify/templates/spec-template.md  ✅ no changes required
  - .specify/templates/tasks-template.md ✅ no changes required
Deferred TODOs:    none
-->

# Scrapariga Constitution

## Core Principles

### I. Architecture & Design (OOP & Modules)

The project MUST be structured in four distinct layers with no cross-layer bypassing:

- **Core**: Browser orchestration logic only — Playwright/Puppeteer lifecycle and session
  bootstrap. No business or parsing logic here.
- **Providers**: One class per target site (e.g., `EnelProvider`, `QuintoAndarProvider`).
  Every Provider MUST extend `BaseScraper` and implement `login()`, `fetchDocuments()`,
  and `download()`.
- **Parsers**: Pure functions or classes for extracting structured data from HTML or PDF.
  Parsers MUST have zero browser/network dependencies, enabling fully isolated unit tests.
- **CLI**: User-facing interface built with Commander.js or Inquirer.js. Only routing and
  output formatting belong here — no scraping logic.

The `BaseScraper` abstract class is the single contract binding all Providers. Adding a new
site REQUIRES a new Provider class. Modifying the shared interface REQUIRES a constitution
amendment.

Dependency Injection MUST be used to supply the browser service to scrapers, enabling test
doubles and session reuse across multiple Providers in the same run.

### II. Scraping Robustness

Scrapers MUST be written defensively against DOM and network instability:

- **Selectors**: MUST prefer `data-testid`, `aria-label`, or stable semantic attributes over
  dynamic CSS class names. XPath expressions anchored on visible text are acceptable.
  Fragile class-based selectors are forbidden without a justifying comment in the code.
- **Retry Logic**: All navigation, form-submission, and download operations MUST implement
  exponential backoff retry with at least 3 attempts before raising a fatal error.
- **Session Persistence**: Cookies and localStorage MUST be persisted to disk so repeated
  runs skip login when a valid session exists. Forced re-authentication MUST log a clear
  reason at `warn` level.

### III. Code Quality & Testing (NON-NEGOTIABLE)

- **TypeScript Strict Mode**: `strict: true` MUST be enabled in `tsconfig.json`. All document
  entities and API contracts MUST be defined as TypeScript interfaces or types. The `any`
  type is forbidden except at explicit, commented integration boundaries.
- **Unit Tests for Parsers**: Every Parser MUST have unit tests using Jest or Vitest. Network
  and browser calls MUST be mocked. Parser tests MUST run in CI without a live browser.
- **Structured Logging**: All runtime log statements MUST use `winston` or `pino` with
  explicit levels (`debug`, `info`, `warn`, `error`). Plain `console.log` in production
  code is forbidden.
- **No Silent Failures**: Every caught error MUST be either re-thrown, logged at `error`
  level, or handled with explicit intent documented in a code comment.

### IV. Security & Privacy (NON-NEGOTIABLE)

- **Credentials**: Passwords, API keys, and session tokens MUST NEVER be hardcoded or
  committed to version control. They MUST be sourced from environment variables (`.env`
  via `dotenv`) or the OS keychain. The `.env` file MUST be listed in `.gitignore`.
- **Download Integrity**: Files MUST be validated for MIME type and, when possible, for
  checksum/hash before being moved to their permanent destination. Partial or invalid
  downloads MUST be discarded and logged at `warn` level.
- **Sensitive Data in Logs**: Log messages MUST NOT include raw passwords, session tokens,
  or full cookie strings. Sensitive fields MUST be masked or omitted before logging.

### V. Design Patterns

The following patterns MUST be applied in their designated contexts:

- **Factory Pattern**: The CLI command handler MUST use a Provider Factory to instantiate
  the correct Provider class based on the user-supplied target name. Direct `new Provider()`
  calls outside the factory are forbidden in CLI code.
- **Strategy Pattern**: Output formatting (JSON, CSV, PDF summary) and download methods
  MUST be implemented as interchangeable Strategy objects injected at runtime — branching
  `if/switch` blocks for format or method selection inside core logic are forbidden.

## Technology Stack

The project's canonical technology stack is:

| Concern              | Chosen Technology                   |
|----------------------|-------------------------------------|
| Language             | TypeScript (Node.js 20 LTS)         |
| Browser Automation   | Playwright (preferred) or Puppeteer |
| CLI Framework        | Commander.js or Inquirer.js         |
| Testing              | Jest or Vitest                      |
| Logging              | winston or pino                     |
| Environment Config   | dotenv                              |
| Package Manager      | npm or pnpm                         |

Deviations from this stack MUST be proposed via a constitution amendment and justified in a
PR description referencing the principle(s) they affect.

## Development Workflow

- All code MUST pass TypeScript compilation (`tsc --noEmit`) and linting checks before a PR
  is opened.
- Every new Provider MUST be accompanied by at least one integration smoke-test (with
  browser mocked) and full Parser unit tests.
- Secrets scanning MUST be part of CI. Any commit introducing credential patterns triggers
  a build failure.
- The `BaseScraper` interface is a breaking-change boundary: any modification REQUIRES
  updating ALL existing Providers before the PR can merge.

## Governance

This constitution supersedes all verbal agreements and informal conventions for the
Scrapariga project. Amendments follow this procedure:

1. Open a PR with the proposed change to `.specify/memory/constitution.md`.
2. State the version bump type (MAJOR / MINOR / PATCH) and rationale in the PR description.
3. If MAJOR: enumerate all Providers and templates that require updates and include them in
   the same PR.
4. PR MUST be reviewed by at least one other contributor before merge.

All feature plans and task lists MUST include a Constitution Check section that verifies
compliance with Principles I–V before implementation begins.

**Version**: 1.0.0 | **Ratified**: 2026-04-02 | **Last Amended**: 2026-04-02
