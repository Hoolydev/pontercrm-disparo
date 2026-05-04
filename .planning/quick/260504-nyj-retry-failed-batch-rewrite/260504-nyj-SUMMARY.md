---
slug: retry-failed-batch-rewrite
status: complete
commit: b0ede3e
date: 2026-05-04
---

# Summary — retry-failed batch rewrite

## Sintoma

Reenvio das 964 conversas falhadas: UI travava em "Agendando…", request nunca voltava (gateway timeout).

## Raiz

Loop sequencial em `apps/api/src/routes/conversations.ts:198-250` fazia 5 ops por conversa × 964 = ~6.000 ops em série. ~150s de waterfall, gateway corta antes em 30-60s.

## Fix

Batch rewrite (commit `b0ede3e`):
- `selectDistinctOn([messages.conversationId])` + INNER JOIN conversations → 1 query pega última msg falhada + sticky instance de todas as convs.
- Bulk INSERT messages.
- UPDATE conversations agrupado por instance (≤ N instances, não N convs).
- `queue.addBulk(jobs)` em uma chamada.

~3-5 ops totais em vez de ~6.000. Estimado ~1-2s para 964 convs.

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- Smoke real precisa do user pós-deploy.

## Smoke recomendado

1. Espera deploy no Railway concluir.
2. Tenta reenvio com 1-2 conversas falhadas primeiro — deve concluir em <1s e voltar mensagem de sucesso.
3. Se OK, dispara o batch de 964.

## Commits

- `b0ede3e` fix(retry-failed): batch the per-conversation work into single round-trips
- (próximo) docs(quick-260504-nyj): plan + summary + STATE update
