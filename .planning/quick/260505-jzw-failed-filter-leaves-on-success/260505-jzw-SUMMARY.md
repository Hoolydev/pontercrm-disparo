---
slug: failed-filter-leaves-on-success
status: complete
commit: b04cd42
date: 2026-05-05
---

# Summary — Falhadas filter sai após sucesso

## Sintoma

Conv com retry bem-sucedido continuava no filtro "Falhadas" (predicate antigo era "tem qualquer msg failed").

## Fix

`apps/api/src/routes/conversations.ts` — predicate e count agora usam:

```sql
(SELECT status FROM messages
 WHERE conversation_id = c.id AND direction='out' AND status<>'queued'
 ORDER BY created_at DESC LIMIT 1) = 'failed'
```

"A última msg outbound visível é failed". Quando retry vira `sent`/`delivered`/`read`, a conv sai do filtro.

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- Smoke real precisa do user pós-deploy.

## Comportamento esperado

| Estado da conv (msgs outbound) | No filtro Falhadas? |
|--------------------------------|----------------------|
| [failed] | sim |
| [failed, sent] | não ← user quer isso |
| [failed, queued (retry em flight)] | sim (retry ainda processando) |
| [sent] | não |
| [sent, failed] | sim (regressão real) |

## Commits

- `b04cd42` fix(inbox): drop conv from "Falhadas" filter after successful retry
- (próximo) docs(quick-260505-jzw): plan + summary + STATE update
