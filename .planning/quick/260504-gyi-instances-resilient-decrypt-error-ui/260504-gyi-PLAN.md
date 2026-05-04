---
slug: instances-resilient-decrypt-error-ui
created: 2026-05-04
mode: gsd-quick
status: complete
---

# Fix: instances list resiliente a configJson corrompido + UI de erro visível

## Sintoma reportado

Menu "Instâncias" fica eternamente em "Carregando…". Clicar em "Nova instância" deixa a tela em branco.

## Diagnóstico

`apps/api/src/routes/instances.ts:20-32` (GET `/whatsapp-instances`) chama `decryptJson` para CADA row dentro do `rows.map(...)`. Se UMA linha tem `configJson` corrompido (chave de encryption rotacionada, plaintext antigo, hand-edit), `decryptJson` lança e a Fastify devolve 500 — toda a lista cai.

`apps/web/app/app/instances/page.tsx:104-107` só lê `data, isLoading`. Sem branch `isError`. Com `retry: 1` no QueryClient, a query fica ~5-10s tentando antes de virar `isError=true` e o componente renderiza grid vazio (não tela branca).

A "tela em branco" no clique provavelmente é JS runtime — sem console do navegador, fix pontual fica para uma quick task posterior se persistir.

## Decisão

Aplicar 2 fixes defensivos cirúrgicos:

1. **Backend**: try/catch em volta do `decryptJson` por row. Falha vira `{ __error: "decryption_failed" }` para aquela row, lista continua.
2. **Frontend**: branch `isError` com mensagem visível + botão "Tentar novamente".

Não tenta resolver "tela em branco no clique" — precisa de log do console do navegador. Fix planejado depende de evidência.

## Tasks

### Task 1: Per-row try/catch no GET + isError UI

**Files:**
- `apps/api/src/routes/instances.ts`
- `apps/web/app/app/instances/page.tsx`

**Action:**
- Backend: substituir `rows.map((r) => ({ ...r, configJson: maskSecrets(decryptJson(...)) }))` por loop com try/catch. Em caso de erro: `app.log.warn` + `configJson = { __error: "decryption_failed" }`.
- Frontend: extrair `isError, error, refetch` do `useQuery`. Adicionar branch `isError` antes do grid renderizando card vermelho com mensagem + botão "Tentar novamente".

**Verify:**
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/web exec tsc --noEmit` → 0 erros.

**Done:**
- 2 arquivos editados.
- Lista não cai mais por causa de 1 row corrompida.
- Erro de fetch fica visível ao usuário.

## Trade-offs aceitos

- `{ __error: "decryption_failed" }` no payload — UI atual não trata; vai mostrar "•••" mascarado nos campos (porque maskSecrets não roda nesse caminho — `__error` não bate o filtro). Visualmente: card aparece com configJson vazio. Mitigação futura: banner "essa instância tem config corrompida — recria".
- "Tela em branco no clique" continua aberta — fix sem evidência seria chute. Próximo passo: pedir console.
- Sem teste automatizado, validação fica em smoke manual do user.

## Verificação manual (user)

1. Acessar `/app/instances` — antes ficava só "Carregando…", agora deve mostrar:
   - Card vermelho com mensagem se a GET realmente falha (ex: "API 500: ..."), OU
   - A lista de instâncias se o backend agora consegue decifrar todas (esperado se só 1 row estava ruim e ela era válida — agora vai aparecer com configJson vazio em vez de 500ar).
2. Se a lista carrega mas alguma instância parece "sem config", essa é a row corrompida — recriar via "Nova instância" ou usar PATCH pra rewrite.
3. Se "Nova instância" ainda dá tela branca: abrir DevTools → Console e copiar a mensagem de erro pra próxima quick task.

## Out of scope

- Fix da tela branca no clique (sem evidência).
- UI específica pra instâncias com `configJson.__error` (banner "recriar").
- Migrar configs corrompidos pra estado limpo (script ops) — só relevante se virar dor recorrente.
