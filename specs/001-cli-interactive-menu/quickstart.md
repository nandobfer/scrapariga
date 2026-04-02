# Quickstart: CLI Interativo SCRAPARIGA

**Branch**: `001-cli-interactive-menu` | **Date**: 2026-04-02

---

## Pré-requisitos

| Requisito | Versão mínima | Verificar com |
|-----------|---------------|---------------|
| Node.js | 20 LTS | `node --version` |
| npm ou pnpm | npm 10+ / pnpm 9+ | `npm --version` |
| Terminal com TTY | Unix-like (Linux/macOS) | — |

> **Windows não é suportado nesta versão.** O layout multi-task usa cursor positioning
> que depende de terminais compatíveis com ANSI escape codes (TTY Unix).

---

## Instalação

```bash
# 1. Clonar o repositório
git clone <repo-url>
cd scrapariga

# 2. Instalar dependências
npm install
# ou
pnpm install

# 3. Instalar browsers do Playwright (apenas uma vez)
npx playwright install chromium
```

---

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```bash
cp .env.example .env
```

> O `.env.example` contém todas as variáveis documentadas com valores de exemplo.
> As variáveis específicas de cada provedor são solicitadas interativamente pela CLI
> se não estiverem preenchidas — **você não precisa preencher tudo antes de começar**.

Variáveis globais (opcionais):

```env
# Nível de log: debug | info | warn | error  (padrão: info)
LOG_LEVEL=info

# Ativa modo demo no menu (padrão: true em desenvolvimento)
NODE_ENV=development

# Força falha em etapa específica do DemoProvider (para testar retry)
# Valores: login | fetch | download   (deixe vazio para execução normal)
DEMO_FAIL_ON=
```

---

## Executar a aplicação

```bash
# Modo desenvolvimento (com pino-pretty para logs legíveis)
npm run dev
# ou diretamente
npx tsx src/index.ts
```

A aplicação exibe o splash screen SCRAPARIGA em ASCII e abre o menu interativo:

```
  ███████╗ ██████╗██████╗  █████╗ ██████╗  █████╗ ██████╗ ██╗ ██████╗  █████╗
  ██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗██║██╔════╝ ██╔══██╗
  ███████╗██║     ██████╔╝███████║██████╔╝███████║██████╔╝██║██║  ███╗███████║
  ╚════██║██║     ██╔══██╗██╔══██╗██╔═══╝ ██╔══██╗██╔══██╗██║██║   ██║██╔══██╗
  ███████║╚██████╗██║  ██║██║  ██║██║     ██║  ██║██║  ██║██║╚██████╔╝██║  ██║
  ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝

  ┌──────────────────────┐
  │  1  Contas           │
  │  2  Nota Fiscal      │
  │  3  Demo             │  ← visível apenas em NODE_ENV=development
  │  4  Sair             │
  └──────────────────────┘
  Use ↑ ↓ ou o número da opção
```

**Navegação**:
- `↑` / `↓` — mover seleção
- número (`1`, `2`, `3`…) — selecionar imediatamente (sem Enter)
- `Enter` — confirmar seleção atual

---

## Navegação pelo menu

### Contas
```
  1  Conta de Luz
  2  Aluguel
  3  Condomínio
  4  Todos          ← executa todos os scripts da categoria em sequência
  5  Voltar
```

### Nota Fiscal
```
  1  Certidão Negativa de Débitos (CND)
  2  Comprovante de Pagamento de Tributos do mês anterior
  3  Todos
  4  Voltar
```

---

## Coleta de credenciais

Se as credenciais necessárias para um provedor não estiverem no `.env`, a aplicação
solicita interativamente:

```
  ⚠️  Credenciais necessárias para Conta de Luz não encontradas.

  Usuário (login do site)
  > _

  Senha (mascarada)
  > ****
```

Os valores fornecidos são salvos automaticamente no `.env`. Nas próximas execuções,
não serão solicitados novamente (a menos que estejam vazios ou removidos).

---

## Exemplo de execução com progresso visual

```
  Executando: Conta de Luz
  ──────────────────────────────────────────────
  🔐 Autenticando...               [████████░░] 80%
  ✅ Autenticado
  📄 Buscando documentos...        [████░░░░░░] 40%
  ✅ 1 documento encontrado
  ⬇️  Baixando fatura...            [██████████] 100%
  ✅ Arquivo salvo em:
     /home/user/scrapariga/documents/conta-de-luz/2026-04-02.pdf

  Pressione qualquer tecla para voltar ao menu...
```

### Em caso de falha com retry:
```
  ⬇️  Baixando fatura...
  ❌ Tentativa 1/3 falhou: Connection timeout
     Aguardando 2s antes da próxima tentativa...
  ❌ Tentativa 2/3 falhou: Connection timeout
     Aguardando 4s antes da próxima tentativa...
  ❌ Tentativa 3/3 falhou: Connection timeout

  Tentar novamente? (s/n) _
```

---

## Executar com o DemoProvider (sem credenciais reais)

O `DemoProvider` simula uma execução completa sem abrir browser ou fazer chamadas de rede.
Ideal para verificar a UI e o renderizador de progresso:

```bash
# Executar normalmente e selecionar "Demo" no menu (apenas em NODE_ENV=development)
npm run dev

# Testar ciclo de retry: forçar falha na etapa de download
DEMO_FAIL_ON=download npm run dev
```

---

## Executar testes

```bash
# Todos os testes
npm test

# Apenas testes unitários
npm run test:unit

# Testes de contrato (verifica shape do BaseScraper)
npm run test:contract

# Modo watch
npm run test:watch
```

**Importante**: todos os testes rodam sem TTY e sem chamadas de rede. Os providers são
testados com Vitest + mocks do BrowserService e do Playwright `Page`.

---

## Implementar um novo provedor

1. Criar `src/providers/<nome>/<nome>.provider.ts` estendendo `BaseScraper`:

```typescript
import { BaseScraper } from '../base-scraper';
import type { BrowserService } from '../base-scraper';
import type { EnvCredential, DocumentMetadata, ScraperResult } from '../interfaces';
import type { Page } from 'playwright';
import type { Logger } from 'pino';

export class MinhaEmpresaProvider extends BaseScraper {
  readonly name = 'minha-empresa';

  readonly requiredCredentials: EnvCredential[] = [
    { key: 'MINHA_EMPRESA_USER', label: 'Usuário', description: 'Login do site', sensitive: false },
    { key: 'MINHA_EMPRESA_PASS', label: 'Senha',   description: 'Senha do site', sensitive: true  },
  ];

  async login(page: Page, credentials: Record<string, string>): Promise<void> {
    this.emitProgress(this.onProgress!, { stepId: 'login', label: 'Autenticando...', status: 'pending' });
    // ... navegação e autenticação específicas do site ...
    this.emitProgress(this.onProgress!, { stepId: 'login', label: 'Autenticado ✅', status: 'success' });
  }

  async fetchDocuments(page: Page): Promise<DocumentMetadata[]> {
    // ... lógica de listagem de documentos ...
    return [{ id: '...', name: '...', url: '...' }];
  }

  async download(page: Page, doc: DocumentMetadata): Promise<ScraperResult> {
    // ... download e/ou extração de dados Pix ...
    return { type: 'file', filePath: this.buildFilePath(doc.name, 'pdf'), mimeType: 'application/pdf', sizeBytes: 0 };
  }
}
```

2. Registrar no `ProviderFactory` em `src/core/provider-factory.ts`.
3. Adicionar entrada no menu correspondente em `src/cli/menus/`.
4. Escrever testes em `tests/unit/providers/<nome>.provider.spec.ts`.

> **Regras da constituição (Princípio I)**:
> - `login()`, `fetchDocuments()` e `download()` NÃO devem conter lógica de retry — o `BaseScraper.run()` já cuida disso.
> - Nenhum provider deve ler `.env` diretamente — credenciais chegam via `credentials` no método `login()`.
> - `console.log` é proibido — use `this.logger.info(...)`.

---

## Estrutura de arquivos gerados

```
documents/
└── conta-de-luz/
    └── 2026-04-02.pdf

sessions/
└── enel.json          ← Playwright storageState (sessão persistida)
```

---

## Scripts npm disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Executa a CLI com tsx (transpila on-the-fly) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm test` | Executa todos os testes com Vitest |
| `npm run test:unit` | Apenas testes unitários |
| `npm run test:contract` | Apenas testes de contrato |
| `npm run test:watch` | Vitest em modo watch |
| `npm run lint` | ESLint + TypeScript type check |
| `npm run typecheck` | `tsc --noEmit` |
