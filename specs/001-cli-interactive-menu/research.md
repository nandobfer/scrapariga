# Research: CLI Interativo SCRAPARIGA

**Branch**: `001-cli-interactive-menu` | **Date**: 2026-04-02  
**Phase**: 0 — Resolve all NEEDS CLARIFICATION before Phase 1 design

---

## R-001: terminal-kit para Menu Interativo e Multi-task UI

**Decision**: Usar `terminal-kit` como única dependência de UI de terminal.

**Rationale**:
- `terminal.singleColumnMenu(items, opts, cb)` — menu com navegação por setas + seleção imediata por número (sem Enter), resolvendo FR-002 e FR-003 nativamente.
- `terminal.inputField(opts, cb)` — prompt de texto mascarável para coleta de credenciais (FR-007); suporte a `echoChar: '*'` para campos sensíveis.
- `terminal.yesOrNo(opts, cb)` — prompt binário para "Tentar novamente?" (FR-016).
- `terminal.progressBar(opts)` — barra de progresso com `title`, `percent`, `eta`; atualizável via `.update(pct)`.
- `terminal.spinner(spinnerName)` — spinner animado por streams; estilos como `'dotSpinner'`, `'classicSpinner'`.
- Cursor API: `terminal.saveCursor()` / `terminal.restoreCursor()` / `terminal.moveTo(row, col)` — base do layout de seções fixas da multi-task UI (FR-014).
- Cores inline: `terminal.green('✅ ...')`, `terminal.red('❌ ...')`, `terminal.yellow('⚠️ ...')`.

**API de multi-task (seções fixas)**:
```
// Antes de iniciar scripts, reservar N linhas:
// 1. Imprimir bloco vazio de N linhas
// 2. terminal.saveCursor() — salva posição após o bloco
// 3. Para atualizar script i: terminal.moveTo(startRow + i, 1) → sobrescreve linha
// 4. Ao final, terminal.restoreCursor() e continuar saída normal
```

**Alternatives considered**:
- Inquirer.js: não suporta reescrever linhas específicas sem redesenhar tudo; sem cursor positioning.
- blessed: mais complexo, menos mantido; overhead desnecessário para este caso de uso.
- cli-progress: apenas progress bars; não resolve menus nem cursor positioning.

---

## R-002: figlet para Splash Screen ASCII

**Decision**: Usar `figlet` com a fonte `"ANSI Shadow"` ou `"Big"`.

**Rationale**:
- `figlet.textSync('SCRAPARIGA', { font: 'ANSI Shadow' })` retorna string multi-linha pronta para
  colorir com `terminal-kit`.
- Fonte `"ANSI Shadow"` produz arte com duplo contorno; `"Big"` é mais simples e bem legível.
- Combinação: `terminal.cyan(figlet.textSync('SCRAPARIGA', { font: 'Big' }))` resolve FR-001.
- `@types/figlet` disponível no npm.

**Alternatives considered**:
- ASCII art hardcoded: frágil a mudanças de nome ou fonte; figlet é mais manutenível.
- `chalk` + `boxen`: cores OK, mas sem geração de arte ASCII grande.

---

## R-003: Padrão de Classe Abstrata (Template Method) para BaseScraper

**Decision**: `BaseScraper` como classe abstrata TypeScript com Template Method em `run()`.

**Rationale**:
```typescript
abstract class BaseScraper {
  // Shared state (injetado via construtor)
  constructor(
    protected readonly browserService: BrowserService,
    protected readonly logger: Logger,
  ) {}

  // Template Method — define o algoritmo; não sobrescrito por providers
  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    const page = await this.browserService.newPage(await this.loadSession());
    await this.retry(() => this.login(page, credentials), onProgress);
    const docs = await this.retry(() => this.fetchDocuments(page), onProgress);
    const result = await this.retry(() => this.download(page, docs[0]), onProgress);
    await this.persistSession(page.context());
    return result;
  }

  // Métodos compartilhados — NÃO sobrescrevidos
  protected emitProgress(cb: ProgressCallback, event: ProgressEvent): void
  protected async retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>
  protected async validateDownload(filePath: string): Promise<void>    // MIME check
  protected buildFilePath(docName: string, ext: string): string        // YYYY-MM-DD
  protected async ensureDir(subDir: string): Promise<string>           // ./documents/name/
  protected async persistSession(ctx: BrowserContext): Promise<void>   // storageState
  protected async loadSession(): Promise<StorageState | undefined>

  // Métodos abstratos — OBRIGATORIAMENTE sobrescritos por providers
  abstract readonly name: string
  abstract readonly requiredCredentials: EnvCredential[]
  abstract login(page: Page, credentials: Record<string, string>): Promise<void>
  abstract fetchDocuments(page: Page): Promise<DocumentMetadata[]>
  abstract download(page: Page, doc: DocumentMetadata): Promise<ScraperResult>
}
```

**Rationale do Template Method**:
- Garante que `run()` sempre chama login → fetchDocuments → download na mesma ordem sem duplicação.
- Cada provider APENAS implementa os 3 métodos abstratos — sem boilerplate de retry, logging, session, paths.
- Testa-se `BaseScraper.run()` uma única vez com um mock; providers testam apenas seus métodos específicos.

**Alternatives considered**:
- Interface pura (sem classe abstrata): cada provider precisaria reimplementar retry, session, paths — violaria DRY e a constituição.
- Mixin pattern: maior complexidade para ganho zero neste caso.

---

## R-004: dotenv Write-Back para Persistência de Credenciais

**Decision**: `dotenv` para leitura + `EnvService` customizado com `fs.readFile`/`fs.writeFile` para escrita.

**Rationale**:
- `dotenv` só lê; não há API oficial de escrita. Soluções de terceiros (`dotenv-manipulator`,
  `dotenv-flow`) adicionam dependência sem ganho: o formato `.env` é trivial (KEY=VALUE por linha).
- `EnvService.set(key, value)`:
  1. Lê `.env` como string.
  2. Se a linha `KEY=...` existe → substitui com regex.
  3. Se não existe → append no final (`\nKEY=value`).
  4. Escreve de volta atomicamente (write to tmp, rename).
- Operação toda com `fs/promises` + lock simples (sem concurrent writes no caso single-user).
- Mascaramento obrigatório antes de logar: `EnvService` nunca passa o valor raw ao logger.

**Alternatives considered**:
- `dotenv-manipulator`: dependência extra para funcionalidade de 20 linhas.
- Reescrever o arquivo inteiro sempre: risco de corrupção se interrompido antes do rename.

---

## R-005: Playwright Storagestate para Sessão Persistente

**Decision**: `browserContext.storageState({ path })` para salvar; `browser.newContext({ storageState: path })` para restaurar.

**Rationale**:
- Playwright exporta cookies + localStorage em JSON para um caminho configurável.
- `./sessions/<provider-name>.json` — um arquivo por provider, isolamento completo.
- Na inicialização do provider: verificar se o arquivo existe → se sim, carregar → se o login falhar (sessão expirada), apagar e logar com `warn`.
- `BaseScraper.persistSession()` e `BaseScraper.loadSession()` encapsulam essa lógica, evitando
  duplicação nos providers.

**Alternatives considered**:
- Cookies-only (sem localStorage): perde sessões de SPAs que usam localStorage para tokens.
- Keychains do OS: mais seguro, mas adiciona complexidade desnecessária para uma ferramenta local.

---

## R-006: Exponential Backoff — Implementação Nativa

**Decision**: Implementar `BaseScraper.retry()` sem biblioteca externa.

**Rationale**:
```typescript
async retry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; onAttempt?: (attempt: number, error: Error) => void },
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      opts.onAttempt?.(attempt, err as Error);
      if (attempt === max) throw err;
      await sleep(opts.baseDelayMs ?? 1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
    }
  }
  throw new Error('unreachable');
}
```
- Delays: tentativa 1→ 1s, tentativa 2 → 2s, tentativa 3 → 4s (mas na 3ª já lança erro).
- `onAttempt` callback permite que a CLI exiba "Tentativa 2/3..." no bloco de progresso.
- Nenhuma biblioteca extra necessária; fácil de testar com Vitest fake timers.

**Alternatives considered**:
- `p-retry`: boa lib, mas adiciona dependência para ~10 linhas de lógica.
- `axios-retry`: específico para axios; não funciona para Playwright actions.

---

## R-007: qrcode-terminal para Renderização de QR Code no Terminal

**Decision**: `qrcode-terminal` com `{ small: true }`.

**Rationale**:
```typescript
import qrcode from 'qrcode-terminal';
qrcode.generate(pixCode, { small: true }); // imprime diretamente no stdout
```
- API síncrona simples; `small: true` usa half-blocks Unicode (▀▄) para metade do tamanho.
- Sem dependências de rede; geração puramente local.
- `@types/qrcode-terminal` disponível.

**Alternatives considered**:
- `qrcode` (npm): gera PNG/SVG, não adequado para terminal.
- `qrcode-png`: idem.

---

## R-008: Validação de MIME de Arquivos Baixados

**Decision**: `file-type` (npm) para detectar MIME real do buffer; rejeitar se diferir do esperado.

**Rationale**:
```typescript
import { fileTypeFromBuffer } from 'file-type';

const buf = await fs.readFile(tmpPath);
const type = await fileTypeFromBuffer(buf);
if (!type || !allowedMimes.includes(type.mime)) {
  await fs.unlink(tmpPath);
  logger.warn({ actual: type?.mime }, 'Download rejeitado: MIME inválido');
  throw new Error(`MIME inválido: ${type?.mime}`);
}
await fs.rename(tmpPath, finalPath);
```
- Download salvo primeiro em arquivo `.tmp`, validado, depois movido para destino final.
- `allowedMimes` declarado pelo provider (ex: `['application/pdf', 'image/png']`).

**Alternatives considered**:
- Checar só a extensão do filename: inseguro, qualquer conteúdo pode ter extensão `.pdf`.
- `mmmagic`: depende de `libmagic` nativa; complexidade de build.

---

## R-009: Logging com pino + pino-pretty

**Decision**: `pino` para logging estruturado; `pino-pretty` em desenvolvimento.

**Rationale**:
```typescript
import pino from 'pino';
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['credentials', '*.password', '*.token'],  // mascara automático
});
```
- `redact` garante que campos sensíveis nunca apareçam em logs (Princípio IV da constituição).
- `pino-pretty` formata JSON para saída legível no terminal em dev (`NODE_ENV=development`).
- `pino` é 5–10× mais rápido que `winston` — irrelevante em performance aqui, mas sem desvantagem.

**Alternatives considered**:
- `winston`: mais configurável, mas mais pesado e sem redact nativo.
- `console.log` colorido: proibido pela constituição (Princípio III).

---

## R-010: DemoProvider — Design da Simulação

**Decision**: `DemoProvider` com 4 etapas simuladas + modo de falha controlado por flag.

**Rationale**:
```typescript
class DemoProvider extends BaseScraper {
  name = 'demo';
  requiredCredentials = []; // sem credenciais necessárias

  async login(page, credentials) {
    // simula login: delay 1.5s + emite ProgressEvent
  }
  async fetchDocuments(page) {
    // simula busca: delay 1s + emite ProgressEvent
    return [{ id: 'demo-doc', name: 'Fatura Demo', url: '' }];
  }
  async download(page, doc) {
    // simula download: delay 2s + emite ProgressEvent
    // se DEMO_FAIL_ON=download → throw Error para testar retry
    return { type: 'file', filePath: './documents/demo/2026-04-02.pdf' };
  }
}
```
- `DEMO_FAIL_ON` env var opcional (ex: `'download'`) força falha em uma etapa específica para
  testar o ciclo de retry da CLI sem precisar de um site externo.
- Registrado no menu como entrada "Demo" visível apenas em `NODE_ENV !== 'production'`.

**Alternatives considered**:
- Mock via Vitest: cobre testes de unidade mas não permite validação visual interativa da UI.
- Provider comentado como exemplo: não executável, não valida a UI end-to-end.

---

## Resoluções de NEEDS CLARIFICATION

Nenhum marcador `NEEDS CLARIFICATION` presente na spec. Todos os pontos foram resolvidos durante
a fase de clarificações (Q1–Q10 em spec.md). Todas as decisões acima são baseadas nos requisitos
funcionais da spec.
