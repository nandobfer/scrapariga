# Feature Specification: CLI Interativo SCRAPARIGA — Menu de Contas e Documentos

**Feature Branch**: `001-cli-interactive-menu`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "cli interativo com splash screen ASCII, menu de navegação por setas e número, seleção de contas (luz, aluguel, condomínio) e nota fiscal (CND, comprovante de pagamento), coleta de credenciais via prompt e salvamento no .env, execução desacoplada de scripts via interface/contrato, progresso visual com loading bars, emojis e logs coloridos"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Splash Screen e Navegação Principal (Priority: P1)

Ao executar a aplicação, o terminal exibe o nome **SCRAPARIGA** em arte ASCII grande e colorida. Imediatamente abaixo aparece um menu interativo com as categorias disponíveis: **Contas** e **Nota Fiscal**. O usuário navega com as setas do teclado (↑ ↓) ou digita o número da opção e pressiona Enter para selecionar.

**Why this priority**: É o ponto de entrada de toda a aplicação. Sem este fluxo nenhuma outra funcionalidade é acessível. Entrega valor imediato e demonstrável.

**Independent Test**: Executar `tsx src/index.ts` em um terminal e verificar: (a) a arte ASCII é exibida, (b) o menu principal aparece, (c) é possível navegar e selecionar uma categoria.

**Acceptance Scenarios**:

1. **Given** a aplicação é iniciada com `tsx src/index.ts`, **When** o terminal renderiza, **Then** o nome SCRAPARIGA aparece em arte ASCII grande acima do menu.
2. **Given** o menu principal está visível, **When** o usuário pressiona ↓ e ↑, **Then** a seleção se move entre "Contas" e "Nota Fiscal" com destaque visual.
3. **Given** o menu principal está visível, **When** o usuário pressiona `1`, **Then** a opção "Contas" é selecionada e confirmada sem precisar pressionar Enter separadamente.
4. **Given** o menu principal está visível, **When** o usuário pressiona `2`, **Then** a opção "Nota Fiscal" é selecionada e confirmada.

---

### User Story 2 — Submenu de Contas com Coleta de Credenciais (Priority: P2)

Ao selecionar "Contas", o usuário vê um segundo menu com as opções **Conta de Luz**, **Aluguel**, **Condomínio** e **Todos**. Ao selecionar uma opção, a aplicação verifica se as credenciais necessárias para aquele script estão presentes no `.env`. Caso não estejam, o usuário é solicitado a informá-las interativamente; os valores fornecidos são persistidos no `.env` para execuções futuras.

**Why this priority**: Contas mensais recorrentes (luz, aluguel, condomínio) representam o caso de uso mais frequente. Define o padrão de coleta de credenciais que todas as outras opções seguem.

**Independent Test**: Sem nenhuma credencial no `.env`, selecionar "Conta de Luz" e verificar que a aplicação: solicita as credenciais via prompt, salva no `.env`, e devolve uma mensagem de confirmação (o script de scraping pode estar em stub).

**Acceptance Scenarios**:

1. **Given** o submenu de Contas é exibido, **When** o usuário navega por setas ou digita o número (1–4), **Then** a opção correspondente é selecionada.
2. **Given** a opção "Conta de Luz" é selecionada e `ENEL_USER` ou `ENEL_PASSWORD` não estão no `.env`, **When** a aplicação inicia, **Then** ela solicita interativamente cada valor faltante com uma mensagem descritiva.
3. **Given** o usuário fornece as credenciais, **When** confirmadas, **Then** os valores são gravados no `.env` e a aplicação prossegue sem solicitar novamente.
4. **Given** a opção "Todos" é selecionada, **When** executada, **Then** os scripts de Conta de Luz, Aluguel e Condomínio são executados em sequência (ou paralelamente), cada um com sua própria saída visual.

---

### User Story 3 — Submenu de Nota Fiscal com Coleta de Credenciais (Priority: P2)

Ao selecionar "Nota Fiscal", o usuário vê um submenu com **Certidão Negativa de Débitos (CND)**, **Comprovante de Pagamento de Tributos do mês anterior** e **Todos**. O mesmo padrão de coleta/persistência de credenciais se aplica.

**Why this priority**: Mesmo prioridade que User Story 2 — compartilha o mesmo contrato de comportamento, apenas com scripts distintos.

**Independent Test**: Selecionar "CND" sem credenciais no `.env` e verificar o prompt de coleta, persistência e prosseguimento.

**Acceptance Scenarios**:

1. **Given** o submenu de Nota Fiscal é exibido, **When** o usuário seleciona "CND", **Then** a aplicação verifica e coleta credenciais faltantes conforme o padrão.
2. **Given** o submenu de Nota Fiscal é exibido, **When** o usuário seleciona "Comprovante de Pagamento", **Then** idem para as credenciais desse script.
3. **Given** "Todos" é selecionado, **When** executado, **Then** ambos os scripts são executados com saída individual e visual para cada um.

---

### User Story 4 — Execução de Script com Progresso Visual (Priority: P1)

Após confirmação de credenciais, o script selecionado é executado. Durante a execução, o terminal exibe uma barra de progresso animada (spinner/progress bar) para cada etapa aguardada (ex: carregamento de página, download). Ao final, o resultado é exibido: path do arquivo baixado, QR Code Pix, código e valor a pagar, ou mensagem de erro — conforme o que o script produzir. A exibição usa emojis e cores adequadas (✅ sucesso, ⚠️ aviso, ❌ erro) e sem informações desnecessárias.

**Why this priority**: Sem feedback visual, a experiência é inutilizável — o usuário não sabe se a aplicação travou ou está processando. Define o contrato de saída que todos os scripts devem seguir.

**Independent Test**: Executar um script stub que emite eventos de progresso e verificar que a UI renderiza corretamente as barras, emojis e cores sem erros.

**Acceptance Scenarios**:

1. **Given** um script está em execução, **When** está aguardando resposta de rede, **Then** uma barra de loading animada é exibida com rótulo descritivo da etapa atual.
2. **Given** a etapa conclui com sucesso, **When** o próximo passo começa, **Then** a barra anterior mostra ✅ e uma nova barra/spinner aparece para a próxima etapa.
3. **Given** uma etapa falha, **When** o erro ocorre, **Then** é exibido ❌ com mensagem de erro em vermelho; a aplicação não trava e exibe opção de tentar novamente ou sair.
4. **Given** o script retorna um arquivo baixado, **When** o download conclui, **Then** o caminho absoluto do arquivo é exibido em verde.
5. **Given** o script retorna dados de pagamento Pix, **When** a execução conclui, **Then** o QR Code é renderizado no terminal, o código Pix copia-e-cola e o valor são exibidos com formatação clara.

---

### Edge Cases

- O que acontece quando o `.env` existe mas contém um valor vazio para uma credencial obrigatória? → A aplicação trata como ausente e solicita novamente.
- O que acontece quando o usuário cancela o prompt de credencial (Ctrl+C)? → A aplicação encerra graciosamente com mensagem de cancelamento, sem corromper o `.env`.
- O que acontece quando dois scripts selecionados via "Todos" têm requisitos de credenciais diferentes? → Cada credencial faltante é solicitada antes de iniciar qualquer script.
- O que acontece quando o terminal não suporta cores ou Unicode? → A aplicação detecta o suporte e exibe fallback sem cores e sem emojis, mantendo a funcionalidade.
- O que acontece quando um script dentro de "Todos" falha? → Os demais continuam; o erro é reportado ao final com ❌ sem interromper os outros.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A aplicação DEVE exibir o nome SCRAPARIGA em arte ASCII grande e colorida ao ser iniciada, antes de qualquer menu.
- **FR-002**: A aplicação DEVE apresentar um menu interativo navegável por setas (↑ ↓) com as categorias "Contas" e "Nota Fiscal".
- **FR-003**: O usuário DEVE poder selecionar qualquer opção do menu digitando seu número (1, 2, 3, 4…) sem precisar pressionar Enter adicionalmente.
- **FR-004**: Ao selecionar "Contas", a aplicação DEVE apresentar submenu com: "Conta de Luz", "Aluguel", "Condomínio", "Todos".
- **FR-005**: Ao selecionar "Nota Fiscal", a aplicação DEVE apresentar submenu com: "Certidão Negativa de Débitos (CND)", "Comprovante de Pagamento de Tributos do mês anterior", "Todos".
- **FR-006**: Antes de executar qualquer script, a aplicação DEVE verificar se todas as variáveis de ambiente necessárias àquele script estão definidas no `.env`.
- **FR-007**: Para cada variável ausente, a aplicação DEVE solicitar ao usuário o valor via prompt interativo com descrição clara do que é esperado.
- **FR-008**: Os valores fornecidos pelo usuário via prompt DEVEM ser persistidos no arquivo `.env` do projeto para uso em execuções futuras.
- **FR-009**: Cada script DEVE ser independente e desacoplado, implementando um contrato (interface) comum definido pela aplicação principal.
- **FR-010**: O contrato dos scripts DEVE incluir: método de execução, método de reporte de progresso por etapas, e estrutura de resultado (arquivo baixado, dados de pagamento, ou erro).
- **FR-011**: Durante a execução de cada script, a aplicação DEVE exibir uma barra de loading / spinner animado por etapa, com rótulo descritivo.
- **FR-012**: Ao concluir cada etapa, a aplicação DEVE atualizar o indicador visual para ✅ (sucesso), ⚠️ (aviso) ou ❌ (erro) com a cor correspondente.
- **FR-013**: Os logs exibidos DEVEM usar cores diferentes por nível: verde para sucesso, amarelo para aviso, vermelho para erro, cinza/branco para informação neutra.
- **FR-014**: A seleção "Todos" em qualquer submenu DEVE executar todos os scripts da categoria, exibindo progresso individual para cada um.
- **FR-015**: Em caso de falha de um script dentro de "Todos", os demais DEVEM continuar executando; o erro é reportado ao fim.

### Key Entities

- **MenuItem**: Representa uma entrada no menu interativo — rótulo exibido, identificador do script vinculado, lista de variáveis de ambiente necessárias.
- **ScraperContract (interface)**: Contrato que todos os scripts de scraping devem implementar — método de execução recebendo credenciais, eventos de progresso emitidos durante execução, e estrutura de resultado padronizada.
- **ProgressEvent**: Evento emitido por um script em execução — identificador da etapa, mensagem descritiva, status (pendente / concluído / erro).
- **ScraperResult**: Resultado final de um script — tipo (arquivo / pagamento / erro), payload específico (caminho do arquivo, dados Pix, ou mensagem de erro).
- **EnvCredential**: Par chave-valor representando uma credencial — chave da variável de ambiente, rótulo amigável para o prompt de coleta, flag de sensibilidade (mascarar input).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário consegue chegar até a execução de qualquer script em menos de 1 minuto a partir do comando de inicialização, sem consultar documentação.
- **SC-002**: 100% dos scripts adicionados ao projeto implementam o contrato definido — nenhum script acessa diretamente variáveis de ambiente ou a UI sem passar pela interface.
- **SC-003**: Nenhuma credencial fornecida pelo usuário é exibida em texto claro nos logs ou outputs do terminal.
- **SC-004**: Ao executar "Todos" em qualquer categoria, o progresso de cada script é visível simultaneamente ou sequencialmente de forma distinguível — sem saídas misturadas sem identificação.
- **SC-005**: Em um terminal com suporte a cores e Unicode, todos os indicadores visuais (cores, emojis, barras de loading) são renderizados corretamente sem caracteres corrompidos.
- **SC-006**: A falha de um script individual não encerra a aplicação nem impede a execução dos demais scripts selecionados.

---

## Assumptions

- O ambiente de execução é um terminal Unix-like (Linux/macOS) com suporte a TTY interativo; Windows não é escopo desta versão.
- O arquivo `.env` é lido e atualizado na raiz do projeto; o usuário tem permissão de escrita nesse arquivo.
- Os scripts de scraping individuais (Enel, Quinto Andar, etc.) serão desenvolvidos separadamente em sprints posteriores; esta especificação cobre apenas o shell da CLI e o contrato que eles devem cumprir.
- A execução de múltiplos scripts via "Todos" será sequencial na primeira versão; paralelismo é melhoria futura.
- Não há sistema de autenticação da própria CLI — a segurança das credenciais é por variável de ambiente, não por login na ferramenta.
- O usuário executa a aplicação com `tsx src/index.ts` (ou um alias/script npm equivalente); não há binário compilado no escopo desta feature.
