# Feature Specification: CLI Interativo SCRAPARIGA — Menu de Contas e Documentos

**Feature Branch**: `001-cli-interactive-menu`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "cli interativo com splash screen ASCII, menu de navegação por setas e número, seleção de contas (luz, aluguel, condomínio) e nota fiscal (CND, comprovante de pagamento), coleta de credenciais via prompt e salvamento no .env, execução desacoplada de scripts via interface/contrato, progresso visual com loading bars, emojis e logs coloridos"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Splash Screen e Navegação Principal (Priority: P1)

Ao executar a aplicação, o terminal exibe o nome **SCRAPARIGA** em arte ASCII grande e colorida. Imediatamente abaixo aparece um menu interativo com as categorias disponíveis: **Contas** e **Nota Fiscal**. O usuário navega com as setas do teclado (↑ ↓) ou digita o número da opção e pressiona Enter para selecionar. O menu também inclui a opção **Sair** para encerrar a aplicação de forma ordenada.

**Why this priority**: É o ponto de entrada de toda a aplicação. Sem este fluxo nenhuma outra funcionalidade é acessível. Entrega valor imediato e demonstrável.

**Independent Test**: Executar `tsx src/index.ts` em um terminal e verificar: (a) a arte ASCII é exibida, (b) o menu principal aparece, (c) é possível navegar e selecionar uma categoria.

**Acceptance Scenarios**:

1. **Given** a aplicação é iniciada com `tsx src/index.ts`, **When** o terminal renderiza, **Then** o nome SCRAPARIGA aparece em arte ASCII grande acima do menu.
2. **Given** o menu principal está visível, **When** o usuário pressiona ↓ e ↑, **Then** a seleção se move entre "Contas" e "Nota Fiscal" com destaque visual.
3. **Given** o menu principal está visível, **When** o usuário pressiona `1`, **Then** a opção "Contas" é selecionada e confirmada sem precisar pressionar Enter separadamente.
4. **Given** o menu principal está visível, **When** o usuário pressiona `2`, **Then** a opção "Nota Fiscal" é selecionada e confirmada.
5. **Given** o menu principal está visível, **When** o usuário seleciona "Sair", **Then** a aplicação encerra de forma ordenada sem mensagem de confirmação adicional.

---

### User Story 2 — Submenu de Contas com Coleta de Credenciais (Priority: P2)

Ao selecionar "Contas", o usuário vê um segundo menu com as opções **Conta de Luz**, **Aluguel**, **Condomínio** e **Todos**. Ao selecionar uma opção, a aplicação verifica se as credenciais necessárias para aquele script estão presentes no `.env`. Caso não estejam, o usuário é solicitado a informá-las interativamente; os valores fornecidos são persistidos no `.env` para execuções futuras.

**Why this priority**: Contas mensais recorrentes (luz, aluguel, condomínio) representam o caso de uso mais frequente. Define o padrão de coleta de credenciais que todas as outras opções seguem.

**Independent Test**: Sem nenhuma credencial no `.env`, selecionar "Conta de Luz" e verificar que a aplicação: solicita as credenciais via prompt, salva no `.env`, e devolve uma mensagem de confirmação (o script de scraping pode estar em stub).

**Acceptance Scenarios**:

1. **Given** o submenu de Contas é exibido, **When** o usuário navega por setas ou digita o número (1–5), **Then** a opção correspondente é selecionada.
2. **Given** o submenu de Contas é exibido, **When** o usuário seleciona "Voltar", **Then** a aplicação retorna ao menu principal imediatamente.
3. **Given** a opção "Conta de Luz" é selecionada e as credenciais necessárias para aquele provedor não estão no `.env`, **When** a aplicação inicia, **Then** ela solicita interativamente cada valor faltante com uma mensagem descritiva.
4. **Given** o usuário fornece as credenciais, **When** confirmadas, **Then** os valores são gravados no `.env` e a aplicação prossegue sem solicitar novamente.
5. **Given** a opção "Todos" é selecionada, **When** executada, **Then** a tela é dividida em seções fixas — uma por script — cada uma exibindo seu próprio bloco de progresso (rótulo, spinner/barra de etapa atual, status ✅/❌); os scripts rodam sequencialmente mas o layout de todas as seções permanece visível simultaneamente.

---

### User Story 3 — Submenu de Nota Fiscal com Coleta de Credenciais (Priority: P2)

Ao selecionar "Nota Fiscal", o usuário vê um submenu com **Certidão Negativa de Débitos (CND)**, **Comprovante de Pagamento de Tributos do mês anterior** e **Todos**. O mesmo padrão de coleta/persistência de credenciais se aplica.

**Why this priority**: Mesmo prioridade que User Story 2 — compartilha o mesmo contrato de comportamento, apenas com scripts distintos.

**Independent Test**: Selecionar "CND" sem credenciais no `.env` e verificar o prompt de coleta, persistência e prosseguimento.

**Acceptance Scenarios**:

1. **Given** o submenu de Nota Fiscal é exibido, **When** o usuário seleciona "CND", **Then** a aplicação verifica e coleta credenciais faltantes conforme o padrão.
2. **Given** o submenu de Nota Fiscal é exibido, **When** o usuário seleciona "Comprovante de Pagamento", **Then** idem para as credenciais desse script.
3. **Given** "Todos" é selecionado, **When** executado, **Then** a tela exibe uma seção fixa por script (CND e Comprovante de Pagamento), cada uma com seu próprio bloco de progresso, visíveis simultaneamente durante toda a execução.
4. **Given** o submenu de Nota Fiscal é exibido, **When** o usuário seleciona "Voltar", **Then** a aplicação retorna ao menu principal imediatamente.

---

### User Story 4 — Execução de Script com Progresso Visual (Priority: P1)

Após confirmação de credenciais, o script selecionado é executado. Durante a execução, o terminal exibe uma barra de progresso animada (spinner/progress bar) para cada etapa aguardada (ex: carregamento de página, download). Ao final, o resultado é exibido: path do arquivo baixado, QR Code Pix, código e valor a pagar, ou mensagem de erro — conforme o que o script produzir. A exibição usa emojis e cores adequadas (✅ sucesso, ⚠️ aviso, ❌ erro) e sem informações desnecessárias.

**Why this priority**: Sem feedback visual, a experiência é inutilizável — o usuário não sabe se a aplicação travou ou está processando. Define o contrato de saída que todos os scripts devem seguir.

**Independent Test**: Executar um script stub que emite eventos de progresso e verificar que a UI renderiza corretamente as barras, emojis e cores sem erros.

**Acceptance Scenarios**:

1. **Given** um script está em execução, **When** está aguardando resposta de rede, **Then** uma barra de loading animada é exibida com rótulo descritivo da etapa atual.
2. **Given** a etapa conclui com sucesso, **When** o próximo passo começa, **Then** a barra anterior mostra ✅ e uma nova barra/spinner aparece para a próxima etapa.
3. **Given** uma etapa falha, **When** o erro ocorre, **Then** o script tenta novamente automaticamente com backoff exponencial (até 3 tentativas), exibindo cada tentativa e seu resultado na seção de progresso; se todas as 3 falharem, exibe ❌ com mensagem de erro em vermelho e o prompt "Tentar novamente? (s/n)"; se o usuário confirmar, o ciclo de 3 tentativas reinicia; caso contrário, retorna ao menu principal.
4. **Given** o script retorna um arquivo baixado, **When** o download conclui, **Then** o arquivo é salvo em `./documents/<nome-do-documento>/YYYY-MM-DD.<extensão>` e o caminho absoluto é exibido em verde.
5. **Given** o script retorna dados de pagamento Pix, **When** a execução conclui, **Then** o QR Code é renderizado no terminal, o código Pix copia-e-cola e o valor são exibidos com formatação clara.
6. **Given** qualquer script termina (sucesso ou erro), **When** o resultado é exibido, **Then** a aplicação aguarda confirmação do usuário (ex: pressionar qualquer tecla) e retorna ao menu principal.

---

### User Story 5 — DemoProvider para Validação da UI (Priority: P1)

Um provedor de demonstração funcional (`DemoProvider`) acompanha o repositório. Ele implementa o `ScraperContract` completo, simulando etapas com delays artificiais, emitindo `ProgressEvent`s e retornando um `ScraperResult` de exemplo (arquivo fictício ou dados Pix fictícios). Permite validar e demonstrar toda a UI — barras de progresso, emojis, retry, resultado final — sem depender de nenhum site externo ou credencial real.

**Why this priority**: Sem o `DemoProvider`, nenhuma das histórias US1–US4 pode ser validada de ponta a ponta. É o artefato de teste da própria CLI.

**Independent Test**: Executar `tsx src/index.ts` e navegar até o `DemoProvider` no menu; verificar que todas as etapas simuladas são exibidas com barras de loading, emojis corretos, retry funcional e resultado final renderizado.

**Acceptance Scenarios**:

1. **Given** o `DemoProvider` está registrado no menu, **When** selecionado, **Then** ele executa pelo menos 3 etapas simuladas com delays visíveis, cada uma exibindo spinner e rótulo descritivo.
2. **Given** o `DemoProvider` está configurado para simular falha em uma etapa, **When** executado, **Then** o ciclo de retry automático (3 tentativas com backoff) é ativado e visível na tela.
3. **Given** o `DemoProvider` conclui com sucesso, **When** o resultado é exibido, **Then** o `ScraperResult` de exemplo (arquivo fictício ou dados Pix fictícios) é renderizado corretamente pela UI.

---


- O que acontece quando o diretório `./documents/<nome-do-documento>/` ainda não existe? → A aplicação cria o diretório automaticamente antes de salvar o arquivo.
- O que acontece quando já existe um arquivo com o mesmo nome (`YYYY-MM-DD.<extensão>`) no diretório destino? → O arquivo existente é sobrescrito; a operação é registrada em log no nível `warn`.
- O que acontece quando o `.env` existe mas contém um valor vazio para uma credencial obrigatória? → A aplicação trata como ausente e solicita novamente.
- O que acontece quando o usuário cancela o prompt de credencial (Ctrl+C)? → A aplicação encerra graciosamente com mensagem de cancelamento, sem corromper o `.env`.
- O que acontece quando o terminal não suporta cores ou Unicode? → **Fora do escopo desta feature.** A aplicação assume terminal Unix-like com suporte a ANSI colors e Unicode/emoji. Detecção de capacidade e modo `PLAIN_OUTPUT` são melhorias futuras.
- O que acontece quando um script dentro de "Todos" falha? → Os demais continuam; o erro é reportado ao final com ❌ sem interromper os outros.
- O que acontece após um script terminar (sucesso ou erro)? → A aplicação retorna automaticamente ao menu principal, permitindo nova seleção sem precisar relançar o comando.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A aplicação DEVE exibir o nome SCRAPARIGA em arte ASCII grande e colorida ao ser iniciada, antes de qualquer menu.
- **FR-002**: A aplicação DEVE apresentar um menu interativo navegável por setas (↑ ↓) com as opções "Contas", "Nota Fiscal" e "Sair".
- **FR-003**: O usuário DEVE poder selecionar qualquer opção do menu digitando seu número (1, 2, 3, 4…) sem precisar pressionar Enter adicionalmente.
- **FR-004**: Ao selecionar "Contas", a aplicação DEVE apresentar submenu com: "Conta de Luz", "Aluguel", "Condomínio", "Todos", "Voltar".
- **FR-005**: Ao selecionar "Nota Fiscal", a aplicação DEVE apresentar submenu com: "Certidão Negativa de Débitos (CND)", "Comprovante de Pagamento de Tributos do mês anterior", "Todos", "Voltar".
- **FR-006**: Antes de executar qualquer script, a aplicação DEVE verificar se todas as variáveis de ambiente declaradas pelo script (via contrato) estão definidas no `.env`. Os nomes concretos das variáveis são de responsabilidade de cada implementação futura de provedor.
- **FR-007**: Para cada variável ausente, a aplicação DEVE solicitar ao usuário o valor via prompt interativo com descrição clara do que é esperado.
- **FR-008**: Os valores fornecidos pelo usuário via prompt DEVEM ser persistidos no arquivo `.env` do projeto para uso em execuções futuras.
- **FR-009**: Cada script DEVE ser independente e desacoplado, implementando um contrato (interface) comum definido pela aplicação principal.
- **FR-010**: O contrato dos scripts DEVE incluir: método de execução que recebe credenciais e um handler de eventos de progresso (callback/listener), e estrutura de resultado final (arquivo baixado, dados de pagamento, ou erro). O script emite `ProgressEvent`s durante a execução; a CLI registra o handler e renderiza cada evento em tempo real.
- **FR-011**: Durante a execução de cada script, a aplicação DEVE exibir uma barra de loading / spinner animado por etapa, com rótulo descritivo.
- **FR-012**: Ao concluir cada etapa, a aplicação DEVE atualizar o indicador visual para ✅ (sucesso), ⚠️ (aviso) ou ❌ (erro) com a cor correspondente.
- **FR-013**: Os eventos de progresso exibidos via `ProgressRenderer` e resultados via `ResultRenderer` DEVEM usar cores por tipo: `terminal.green` para sucesso, `terminal.yellow` para aviso, `terminal.red` para erro, `terminal.gray` para informação neutra. Os logs de sistema emitidos pelo `pino` DEVEM usar `pino-pretty` com colorização automática por nível (`debug`, `info`, `warn`, `error`).
- **FR-014**: A seleção "Todos" em qualquer submenu DEVE executar todos os scripts da categoria sequencialmente, exibindo uma seção fixa por script na tela — cada seção com seu próprio bloco de progresso (rótulo, spinner/barra de etapa, status final) visível simultaneamente durante toda a execução.
- **FR-015**: Em caso de falha de um script dentro de "Todos", os demais DEVEM continuar executando; o erro é reportado na seção fixa do script com o ciclo de retry descrito em FR-016.
- **FR-016**: Em caso de falha de qualquer etapa de um script, a aplicação DEVE tentar novamente automaticamente com backoff exponencial, até 3 tentativas, exibindo cada tentativa e seu status em tempo real na seção de progresso do script. Após esgotar as 3 tentativas, DEVE exibir o prompt "Tentar novamente? (s/n)"; ao confirmar, o ciclo reinicia; ao negar, a execução do script é encerrada e a aplicação retorna ao menu principal.

- **FR-017**: A aplicação DEVE incluir um `DemoProvider` funcional que implementa o `ScraperContract` completo, simulando pelo menos 3 etapas com delays artificiais, emitindo `ProgressEvent`s reais e retornando um `ScraperResult` de exemplo. O `DemoProvider` NÃO deve fazer chamadas de rede reais.

- **MenuItem**: Representa uma entrada no menu interativo — rótulo exibido, identificador do script vinculado, lista de variáveis de ambiente necessárias.
- **ScraperContract (interface)**: Contrato que todos os scripts de scraping devem implementar — método de execução recebendo credenciais e um callback/listener de `ProgressEvent`, retornando `ScraperResult` ao concluir. O script não conhece a UI; apenas emite eventos padronizados.
- **ProgressEvent**: Evento emitido pelo script durante execução via callback — identificador da etapa, mensagem descritiva, status (pendente / concluído / erro). A CLI consome esses eventos para atualizar barras e spinners em tempo real.
- **ScraperResult**: Resultado final de um script — tipo (arquivo / pagamento / erro), payload específico: para arquivo, o caminho relativo dentro de `./documents/<nome-do-documento>/YYYY-MM-DD.<extensão>`; para pagamento, dados Pix (QR Code, código, valor); para erro, mensagem descritiva.
- **EnvCredential**: Par chave-valor representando uma credencial — chave da variável de ambiente, rótulo amigável para o prompt de coleta, flag de sensibilidade (mascarar input).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário consegue chegar até a execução de qualquer script em menos de 1 minuto a partir do comando de inicialização, sem consultar documentação.
- **SC-002**: 100% dos scripts adicionados ao projeto implementam o contrato definido — nenhum script acessa diretamente variáveis de ambiente ou a UI sem passar pela interface.
- **SC-003**: Nenhuma credencial fornecida pelo usuário é exibida em texto claro nos logs ou outputs do terminal.
- **SC-004**: Ao executar "Todos", cada script ocupa uma seção fixa e identificada na tela durante toda a execução — nenhuma saída de scripts diferentes aparece misturada na mesma linha ou bloco.
- **SC-005**: Em um terminal com suporte a cores e Unicode, todos os indicadores visuais (cores, emojis, barras de loading) são renderizados corretamente sem caracteres corrompidos.
- **SC-006**: A falha de um script individual não encerra a aplicação nem impede a execução dos demais scripts selecionados.

---

## Clarifications

### Session 2026-04-02

- Q: Após um script terminar (sucesso ou erro), o que acontece com a aplicação? → A: Retorna ao menu principal
- Q: O menu principal deve ter uma opção explícita de "Sair"? → A: Sim — opção "Sair" aparece no menu principal (sem confirmação)
- Q: Como o progresso é apresentado ao executar "Todos"? → A: Cada script ocupa uma seção fixa na tela com seu próprio bloco de progresso (estilo multi-task UI)
- Q: Como o ScraperContract comunica progresso à CLI? → A: Via eventos/callbacks — o script emite ProgressEvents durante a execução; a CLI escuta e renderiza em tempo real
- Q: Onde os arquivos baixados são salvos? → A: Caminho fixo `./documents/<nome-do-documento>/YYYY-MM-DD.<extensão>` relativo à raiz do projeto
- Q: A aplicação suporta múltiplos perfis de usuário? → A: Não — perfil único; um `.env` com as credenciais de uma pessoa
- Q: O que acontece quando um script falha? → A: Retry automático com backoff exponencial (até 3 tentativas), progresso e erros sempre visíveis; após esgotar tentativas, exibe prompt "Tentar novamente? (s/n)" antes de retornar ao menu
- Q: Os submenus devem ter opção "Voltar"? → A: Sim — opção "Voltar" aparece em cada submenu após as opções de conteúdo

---

## Assumptions

- O ambiente de execução é um terminal Unix-like (Linux/macOS) com suporte a TTY interativo; Windows não é escopo desta versão.
- O arquivo `.env` é lido e atualizado na raiz do projeto; o usuário tem permissão de escrita nesse arquivo.
- Esta feature entrega: (1) o shell da CLI com menu e navegação, (2) o mecanismo de coleta e persistência de credenciais, (3) o contrato `ScraperContract`, (4) o `DemoProvider` funcional para validação da UI, e (5) um stub de entrada no menu apontando para o `DemoProvider`. Provedores reais são desenvolvidos em features posteriores.
- A execução de múltiplos scripts via "Todos" é sequencial; o layout multi-task (seções fixas por script) é renderizado antes do início para que todas as seções fiquem visíveis desde o começo. Paralelismo real é melhoria futura.
- Não há suporte a múltiplos perfis de usuário. A aplicação gerencia um único conjunto de credenciais via `.env`, correspondente a uma única pessoa. Suporte a perfis é explicitamente fora de escopo.
- Não há sistema de autenticação da própria CLI — a segurança das credenciais é por variável de ambiente, não por login na ferramenta.
- O usuário executa a aplicação com `tsx src/index.ts` (ou um alias/script npm equivalente); não há binário compilado no escopo desta feature.
- Após cada execução de script, a aplicação retorna automaticamente ao menu principal — a sessão da CLI persiste até o usuário sair explicitamente (ex: Ctrl+C ou opção "Sair" no menu).
- Suporte a terminais sem cores ou Unicode está explicitamente fora do escopo desta feature. A aplicação assume terminal Unix-like com TTY interativo e suporte completo a ANSI colors e Unicode/emoji. Detecção de capacidade terminal e modo `PLAIN_OUTPUT` são melhorias futuras.
