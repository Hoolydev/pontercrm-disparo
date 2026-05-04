---
slug: anti-padrao-3-domain-events
status: complete
commit: e28f171
date: 2026-05-03
---

# Summary — Domain events (anti-padrão 3)

## O que foi feito

### Schema + migration

- `packages/db/src/schema/domain-events.ts` — tabela `domain_events` com `aggregate_type`, `aggregate_id`, `event_type`, `payload_json`, `actor`, `occurred_at`. Sem FK em `aggregate_id` (preserva log se row for arquivada). 2 indexes: `(aggregate_type, aggregate_id, occurred_at)` e `(event_type, occurred_at)`.
- `packages/db/drizzle/0010_domain_events.sql` — DDL puro estilo 0009 (sem snapshot, hand-written).
- `packages/db/drizzle/meta/_journal.json` — entry idx 10.
- `packages/db/src/schema/index.ts` — export do barrel.
- `packages/shared/src/roles.ts` — `DOMAIN_AGGREGATE_TYPE` (`lead | conversation | broker_queue`) + `DOMAIN_EVENT_TYPE` (`lead.stage_changed | conversation.status_changed | broker.assigned`) com type aliases.

### Helper

`packages/agent-engine/src/lib/domain-events.ts` → `recordEvent(db, aggregateType, aggregateId, eventType, opts?)`. Sem catch interno: erro propaga (sinal correto em dev se schema não migrado).

Reexportado em `packages/agent-engine/src/index.ts`.

### Integrações nos services

| Service | Branch | Event |
|---------|--------|-------|
| `changeLeadStage` (lib/leads.ts) | `changed: true` | `lead.stage_changed` — payload `{previousStageId, newStageId}` |
| `transitionConversationStatus` (lib/conversations.ts) | `changed: true` | `conversation.status_changed` — payload `{from, to, handoffReason, assignedBrokerId}`. Adicionado `actor?` em opts. |
| `recordBrokerAssignment` (lib/distribution.ts) | `reused: false` | `broker.assigned` — payload `{leadId, brokerId, conversationId, priorityHint, timeoutAt, reason}` |

`actor` é null em todos call sites hoje — UI/JWT plumbing entra depois.

## Verificação

- `pnpm --filter @pointer/shared build` → 0 erros.
- `pnpm --filter @pointer/db build` → 0 erros.
- `pnpm --filter @pointer/agent-engine build` → 0 erros.
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/worker exec tsc --noEmit` → 0 erros.
- `grep -rn "recordEvent" packages/agent-engine/src/lib/ src/index.ts` → 4 hits (1 def + 3 callers + 1 reexport).

## Trade-offs implementados (do PLAN)

- Sem catch interno em `recordEvent` — falha de insert do audit propaga (preferência por sinal alto).
- Sem FK em `aggregate_id` — preserva log se aggregate row for deletada/arquivada.
- Sem versionamento de payload — schema do payload pode evoluir; consumers futuros toleram.
- Pubsub `inbox:updates` permanece intocado — domain_events é log durável paralelo, não substituto.

## Pendências para o usuário

- **Aplicar migration 0010 no Neon**: `pnpm --filter @pointer/db migrate` ou aplicar SQL direto. Sem isso, qualquer chamada aos 3 services em produção vai falhar com "relation domain_events does not exist".
- Restart workers/api após migration aplicada.
- Próximo passo do refactor: anti-padrão 5 (menu reorg) ou 2 (UI dedup) — ambos só UI, ordem importa pouco.

## Commits

- `e28f171` feat(agent-engine,db): durable domain_events audit log
- (próximo) docs(quick-260503-vc7): plan + summary + STATE update
