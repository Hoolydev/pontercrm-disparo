---
slug: anti-padrao-1-service-layer
status: complete
commit: a80a428
date: 2026-05-03
---

# Summary — Service layer (anti-padrão 1)

## O que foi feito

Criados 2 services em `packages/agent-engine/src/lib/`:
- `leads.ts` → `changeLeadStage(db, leadId, newStageId)`: idempotente, atualiza `pipeline_stage_id` + `stage_entered_at = NOW()` em uma única statement.
- `conversations.ts` → `transitionConversationStatus(db, convId, newStatus, opts?)`: valida a matriz `ai_active ↔ handed_off → closed`, força `aiPaused=true` em handed_off e limpa `handoffReason` ao voltar pra ai_active.

Reexportados pelo barrel `packages/agent-engine/src/index.ts`.

## Callers migrados (5)

| Site | Antes | Depois |
|------|-------|--------|
| `apps/api/src/routes/leads.ts` PATCH /leads/:id/stage | `db.update(schema.leads).set({ pipelineStageId })` | `changeLeadStage(db, id, stageId)` |
| `apps/api/src/routes/leads.ts` POST /leads override | bulk update overrides | broker via update direto + `changeLeadStage` para stage |
| `packages/agent-engine/src/tools/update-stage.ts` | no-op manual + UPDATE | `changeLeadStage` (mantém publish + cancelPendingFollowupsForLead) |
| `packages/agent-engine/src/tools/transfer-to-broker.ts` | UPDATE conversations 4 campos | `transitionConversationStatus(..., "handed_off", { handoffReason, assignBrokerId })` |
| `apps/api/src/routes/conversations.ts` POST /takeover e /release | UPDATE conversations | `transitionConversationStatus` |

## Bug latente fechado

`stage_entered_at` agora é refrescado em todos os caminhos que mudam stage (3 sites). O SLA sweep (`apps/worker/src/jobs/sla-alerts-sweep.ts`) finalmente lê o relógio do estágio atual em vez do timestamp de criação do lead.

## Verificação

- `pnpm --filter @pointer/agent-engine exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros (após `pnpm --filter @pointer/agent-engine build` para regenerar `dist/`).
- `pnpm --filter @pointer/worker exec tsc --noEmit` → 0 erros.
- `grep -rn 'set.*pipelineStageId' apps/api/src packages/agent-engine/src` → vazio nos arquivos migrados.
- `grep -rn 'set.*status:.*"(handed_off|ai_active)"' apps/api/src/routes/conversations.ts packages/agent-engine/src/tools/transfer-to-broker.ts` → vazio.
- `stage_entered_at` referenciado apenas em `sla-alerts-sweep.ts` (leitura) + `lib/leads.ts` (escrita) + schema.

## Decisões registradas no PLAN.md

- `brokerQueueService.update` foi descartado (sem callers admin de mutação — broker-queue.ts é read-only; writes determinísticos já estão em `lib/distribution.ts` + workers).
- `agent_id` mantido durante handoff (engine usa pra swap outbound→inbound; zerar quebraria continuidade no /release).
- Service não publica pubsub nem chama `recordEvent` — fica para o anti-padrão 3.
- PATCH /leads/:id/assign não migrado (não é transição de status).

## Commits

- `a80a428` refactor(api,agent-engine): service layer for lead stage + conversation status
- (próximo) docs(quick-260503-trt): plan + summary + STATE update
