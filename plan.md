# Correção do Fluxo de Login do Condomínio

## ✅ Implementação Concluída - Race Condition Pattern

### Problema Identificado

O `condominio.provider.ts` estava travando em "Preenchendo e-mail..." porque usava `isVisible()` que é **instantâneo** - não aguardava elementos aparecerem. Quando havia sessão restaurada, o grid de cobranças levava alguns segundos para carregar, então `isVisible()` retornava `false` e o código sempre tentava fazer login.

**Cenário 1: Email novo / primeira vez**
1. Preencher `<input id="email">`
2. Campo senha NÃO visível → clicar "Entrar Agora" → senha aparece
3. Preencher `<input id="senha">`
4. Clicar "Entrar" → faz login

**Cenário 2: Email conhecido / retornando**
1. Preencher `<input id="email">`  
2. Campo senha JÁ VISÍVEL → pular "Entrar Agora"
3. Preencher `<input id="senha">`
4. Clicar "Entrar" → faz login

### Solução Implementada - Promise.race()

```typescript
await page.goto(CONDO_URL, { waitUntil: 'networkidle', timeout: 30_000 });

// Aguardar qual elemento aparece primeiro (race condition)
const pageState = await Promise.race([
  page
    .locator('.bloco-grid-cobrancas')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'logged-in' as const),
  page
    .locator('#email')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'login-page' as const),
]).catch(() => 'unknown' as const);

if (pageState === 'logged-in') {
  // Sessão restaurada, pular login
  this.emitStep({ stepId: 'login', label: 'Sessão restaurada', status: 'success' });
  return;
}

if (pageState === 'unknown') {
  throw new Error('Timeout: nem login nem grid de cobranças apareceram após 10 segundos');
}

// pageState === 'login-page', continuar com login...
```

### Arquivos Modificados

- ✅ `src/providers/condominio/condominio.provider.ts` (linhas 170-198)
  - Substituído `isVisible()` instantâneo por `Promise.race()` com `waitFor()`
  - Aguarda `.bloco-grid-cobrancas` OU `#email` aparecer (timeout 10s cada)
  - Tratamento de erro se nenhum aparecer
  - Removido `waitFor` redundante do campo email (já detectado no race)

- ✅ `tests/unit/providers/condominio.provider.spec.ts`
  - Atualizados 3 testes para mockar `waitFor()` corretamente
  - Mock usa Promise com setTimeout para simular timeout realista
  - Total: 108 testes passando (mantido)

### Benefícios da Abordagem

1. **Justo**: Não favorece nenhum cenário - quem aparecer primeiro vence
2. **Robusto**: Aguarda ativamente ao invés de verificação instantânea
3. **Claro**: Código explícito sobre qual elemento está sendo detectado
4. **Configurável**: Timeout de 10s pode ser ajustado se necessário

## ⏳ Próximos Passos (Testes Manuais)

1. **Teste com sessão válida** - Executar `npm run start` → Contas → Condomínio (deve detectar grid e pular login)
2. **Teste sem sessão** - Deletar `sessions/condominio.json` e testar (deve detectar #email e fazer login)
3. **Confirmar que não trava** mais em "Preenchendo e-mail"

## Notas Técnicas

- `Promise.race()` resolve com o primeiro Promise que completar
- Se ambos derem timeout, `.catch(() => 'unknown')` captura e lança erro descritivo
- Timeout de 10 segundos balanceia entre responsividade e páginas lentas
- Se grid aparecer primeiro, login é pulado completamente (sessão restaurada)
- Se email aparecer primeiro, fluxo de login continua normalmente
