---
slug: anti-padrao-1-service-layer
created: 2026-05-03
mode: gsd-quick
status: draft
---

# Service layer — Anti-padrão 1 (passo 2 do plano de refactor)

## Contexto

Anti-padrão 1 do plano de refactor: callers mutam `leads.pipeline_stage_id` e `conversations.status` em vários lugares e cada um tem que lembrar das invariantes. O custo concreto:

- **Bug latente — SLA worker silencioso**: `leads.stage_entered_at` é o relógio do `sla-alerts-sweep` (apps/worker/src/jobs/sla-alerts-sweep.ts:60). Mas todo mundo que faz `UPDATE leads SET pipeline_stage_id = …` esquece de tocar `stage_entered_at`. Resultado: SLA dispara contra a entrada inicial do lead, não contra a entrada no estágio atual. Sites afetados:
  - `apps/api/src/routes/leads.ts:169` (PATCH /leads/:id/stage)
  - `apps/api/src/routes/leads.ts:144` (POST /leads override quando admin escolhe stage)
  - `packages/agent-engine/src/tools/update-stage.ts:99` (tool da IA)
- **Invariante esquecida — handoff sem limpar agentId**: `conversations.status = 'handed_off'` é setado em transfer-to-broker.ts:69, conversations.ts:281 (takeover) e leads.ts:189-196 (assign). Nenhum limpa `agent_id`, então a conversa "handed off" continua amarrada ao agente IA — não causa bug funcional hoje (engine pula handed_off), mas polui queries por agent.

Escopo restrito ao service layer **deste passo**. Não mexe em domain_events (anti-padrão 3), UI (2/5).

### Por que NÃO criar `brokerQueueService.update`

Auditoria mostrou que `broker_queue` writes só acontecem em código determinístico já encapsulado: `distribution.ts:markBrokerAccepted`, `distribution-watchdog.ts`, `followup-processor.ts:redistribute_15d`. Não há rota HTTP de update administrativo (broker-queue.ts é read-only). Criar wrapper seria abstração prematura.

## Decisões

### Onde os services moram

`packages/agent-engine/src/lib/leads.ts` e `packages/agent-engine/src/lib/conversations.ts` — mesmo padrão de followups.ts, distribution.ts, scoring.ts (helpers puros, reutilizáveis por API + worker + tools). NÃO criar `apps/api/src/services/` (não é o padrão do repo).

Reexportar do barrel `packages/agent-engine/src/index.ts` para callers da API.

### `leadService.changeStage`

```ts
export async function changeLeadStage(
  db: Database,
  leadId: string,
  newStageId: string,
  opts?: { actor?: string }
): Promise<{ changed: boolean; previousStageId: string | null }>
```

Comportamento:
1. Lê `lead.pipelineStageId` atual.
2. Se `newStageId === current` → no-op, retorna `{ changed: false, previousStageId: current }`. (Já é o que update-stage.ts faz manualmente; consolida.)
3. Caso contrário: `UPDATE leads SET pipeline_stage_id = $1, stage_entered_at = NOW() WHERE id = $2` em uma única statement (atômico — sem transaction wrapper, é 1 row).
4. Retorna `{ changed: true, previousStageId }`.

**Não** valida se `newStageId` existe nem se pertence à pipeline correta — esse é trabalho do caller (rotas e tool já fazem). Service garante só a invariante de tempo.

**Não** dispara publisher/cancela followups — esses são side effects específicos do caller (a tool da IA quer pubsub + cancel; a rota PATCH não quer). Service fica enxuto.

### `conversationService.transitionStatus`

```ts
export async function transitionConversationStatus(
  db: Database,
  conversationId: string,
  newStatus: ConversationStatus,
  opts?: {
    handoffReason?: string | null;
    assignBrokerId?: string | null;
    aiPaused?: boolean;
  }
): Promise<{ changed: boolean }>
```

Comportamento:
1. Lê status atual.
2. Valida transição contra matriz:
   - `ai_active` → `handed_off` ✓
   - `ai_active` → `closed` ✓
   - `handed_off` → `ai_active` ✓ (release)
   - `handed_off` → `closed` ✓
   - `closed` → qualquer ✗ (terminal)
   - mesma → mesma = no-op
3. Monta patch base: `{ status: newStatus }`.
4. Invariantes automáticas (não-opcionais):
   - `newStatus === 'handed_off'`: força `aiPaused: true`. Se opts.aiPaused for explicitamente `false`, ignora (handoff sempre pausa IA).
   - `newStatus === 'ai_active'`: força `handoffReason: null` (limpa motivo do handoff anterior; espelha o que /release já faz hoje).
   - `newStatus === 'closed'`: idempotente — terminal.
5. Aplica overrides opcionais: `handoffReason`, `assignedBrokerId`, `aiPaused` (quando não conflita com regra acima).
6. UPDATE em row única.

**Não** mexe em `agent_id`. Engine usa agentId para o swap outbound→inbound (run.ts:165) e para reload de contexto — limpar agentId no handoff quebraria reuso futuro do agente quando a conv volta pra `ai_active` via /release. Decisão consciente: agentId fica.

**Não** cria broker_queue / followups / publish — esses ficam no caller (transfer-to-broker.ts orquestra).

### Migração de callers

Migrar EXATAMENTE estes 5 sites — não expandir escopo:

1. `apps/api/src/routes/leads.ts:167-170` (PATCH /leads/:id/stage) → `changeLeadStage(db, id, stageId)`.
2. `apps/api/src/routes/leads.ts:140-145` (POST /leads override quando body tem `pipelineStageId`) → após o ingestLead, se override de stage, chamar `changeLeadStage`. Override de `assignedBrokerId` continua direto (não tem invariante de tempo).
3. `packages/agent-engine/src/tools/update-stage.ts:86-100` → substituir o no-op manual + UPDATE por `changeLeadStage`. Se `result.changed === false`, retornar a resposta `unchanged` que já existe. Se `true`, segue para o publish + cancelPendingFollowupsForLead que já existe.
4. `packages/agent-engine/src/tools/transfer-to-broker.ts:67-75` → `transitionConversationStatus(db, conversationId, 'handed_off', { handoffReason: reason, assignBrokerId: targetBroker, aiPaused: true })`. Resto da função (lead.assignedBrokerId, recordBrokerAssignment, createBrokerFollowups, brokerNotify) permanece.
5. `apps/api/src/routes/conversations.ts:279-283` (POST /conversations/:id/takeover) e `apps/api/src/routes/conversations.ts:351-355` (POST /conversations/:id/release) → `transitionConversationStatus`.

**Fora deste passo** (intencional, evita escopo creep):
- `apps/api/src/routes/leads.ts:188-196` (PATCH /assign reseta conv.assignedBrokerId mas não muda status). Não é uma transição.
- `packages/agent-engine/src/run.ts:167, 241, 349` — só mexem em `lastMessageAt` ou `agentId` (swap outbound→inbound). Não são transições de status.

## Tasks

### Task 1: Criar `leadService` + `conversationService` em `packages/agent-engine/src/lib/`

**Files:**
- `packages/agent-engine/src/lib/leads.ts` (novo)
- `packages/agent-engine/src/lib/conversations.ts` (novo)
- `packages/agent-engine/src/index.ts` (reexportar)

**Action:**
- Criar `changeLeadStage(db, leadId, newStageId, opts?)` em `lib/leads.ts` com a assinatura/comportamento decidido acima. Importar `schema` de `@pointer/db`. Tipo `Database` segue o padrão de `lib/distribution.ts` (peek lá pra usar a mesma assinatura).
- Criar `transitionConversationStatus(db, conversationId, newStatus, opts?)` em `lib/conversations.ts`. Constante interna `VALID_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]>`. Importar `ConversationStatus` de `@pointer/shared`.
- Reexportar ambas no `index.ts` do pacote (`export { changeLeadStage } from "./lib/leads.js"` etc.).
- Erros de transição inválida lançam `Error` com mensagem `invalid conversation transition: <from> → <to>` — caller decide como mapear pra HTTP. Para no-op, retorna `{ changed: false }` sem throw.

**Verify:**
- `pnpm --filter @pointer/agent-engine tsc --noEmit` limpo.
- Import de `changeLeadStage` e `transitionConversationStatus` resolvido a partir de `@pointer/agent-engine`.

**Done:** ambas as funções existem, exportadas, tipadas, sem callers ainda.

---

### Task 2: Migrar callers para os services

**Files:**
- `apps/api/src/routes/leads.ts`
- `apps/api/src/routes/conversations.ts`
- `packages/agent-engine/src/tools/update-stage.ts`
- `packages/agent-engine/src/tools/transfer-to-broker.ts`

**Action:**
- `routes/leads.ts:167-170` (PATCH /leads/:id/stage): substituir o `db.update(schema.leads)…` pelo `changeLeadStage(db, req.params.id, body.data.stageId)`. Manter validação `pipelineStages.findFirst` que já existe (service não valida existência do stage).
- `routes/leads.ts:140-145`: extrair override de `pipelineStageId` do `overrides` e fazer chamada separada `changeLeadStage(db, leadId, body.data.pipelineStageId)` após o `db.update(...).set(overrides)`. Override de `assignedBrokerId` continua via `overrides`.
- `tools/update-stage.ts`: depois do `if (!stage) return error`, chamar `const { changed } = await changeLeadStage(db, conv.leadId, stage.id)`. Se `!changed`, retornar a resposta `unchanged: true` já existente (linhas 86-95). Caso contrário, prosseguir com `cancelPendingFollowupsForLead` + `publisher.publish` + return ok como hoje. Remover o UPDATE manual (linhas 97-100) e o `if (stage.id === conv.lead.pipelineStageId)` redundante.
- `tools/transfer-to-broker.ts:67-75`: substituir o `db.update(schema.conversations).set({ aiPaused: true, status: "handed_off", assignedBrokerId: targetBroker ?? undefined, handoffReason: reason })…` por `await transitionConversationStatus(db, conversationId, "handed_off", { handoffReason: reason, assignBrokerId: targetBroker ?? null })`. (`aiPaused: true` é forçado pelo service.)
- `routes/conversations.ts` POST /takeover (~linhas 279-283): substituir o `db.update().set({ aiPaused: true, status: "handed_off", assignedBrokerId: assignBrokerId ?? undefined })…` por `await transitionConversationStatus(db, conv.id, "handed_off", { assignBrokerId: assignBrokerId ?? null })`. Mantém `handoffReason: null` implícito (não é setado hoje, ok).
- `routes/conversations.ts` POST /release (~linhas 351-355): substituir por `await transitionConversationStatus(db, conv.id, "ai_active", { aiPaused: false })`. Service já força `handoffReason: null`.

**Verify:**
- `pnpm tsc --noEmit -p apps/api` limpo.
- `pnpm --filter @pointer/agent-engine tsc --noEmit` limpo.
- `pnpm tsc --noEmit -p apps/worker` limpo (não toca, mas confirmação rápida).
- `grep -rn "stage_entered_at\|stageEnteredAt" apps/api/src apps/worker/src packages/agent-engine/src` — ainda aparece só no SLA sweep + schema. Não vaza pra calling code.

**Done:**
- 5 sites migrados.
- Nenhum `db.update(schema.leads).set({ pipelineStageId` direto nos 3 arquivos editados.
- Nenhum `db.update(schema.conversations).set({ status:` direto nos 3 arquivos editados (run.ts/leads.ts /assign permanecem — fora de escopo).

## Trade-offs aceitos

- **Sem transactions wrapper**: `changeLeadStage` é UPDATE de 1 row → atômico por si só. Adicionar `db.transaction()` aqui seria overhead sem ganho (não há leitura prévia atômica em jogo — o "no-op se igual" pode usar a row já lida pelo caller, mas o service relê 1 row pra ser self-contained; aceito o custo de 1 query extra em troca de API limpa).
- **Service não publica em pubsub**: caller (tool da IA) ainda chama `publisher.publish` direto. Faria sentido moverpara o service no anti-padrão 3 (domain_events) — agora seria mistura prematura.
- **`handoffReason` não é setado no /takeover**: comportamento atual da rota (não setava). Manter idêntico evita regressão de UX. Se quisermos auditar takeover vs transfer, vira issue separada.
- **`agentId` não é zerado no handoff**: decisão consciente — engine usa pra reload de contexto e swap outbound→inbound. Se zerássemos, /release voltaria pra `ai_active` com agente nulo e quebraria continuidade.

## Verificação

Manual após executor:
- `pnpm --filter @pointer/agent-engine tsc --noEmit` → 0 erros.
- `pnpm tsc --noEmit -p apps/api` → 0 erros.
- Smoke conceitual (sem rodar): tool `update_stage` num lead "qualificado" → DB mostra `stage_entered_at` ≈ NOW(). PATCH /leads/:id/stage idem. POST /takeover → conv.aiPaused=true, status=handed_off. POST /release → status=ai_active, handoffReason=null.

## Out of scope

- Anti-padrão 3 (domain_events) — service vai chamar `recordEvent()` num passo futuro.
- Anti-padrão 2 (UI dedup), 5 (menu reorg).
- `routes/leads.ts:188-220` (PATCH /assign) — não é transição de status, só reseta broker.
- `packages/agent-engine/src/run.ts` — só mexe em `lastMessageAt`/`agentId`, não é transição de status.
- Testes automatizados — repo não tem suite estruturada hoje; verificação é typecheck + smoke manual.
- `brokerQueueService.update` — descartado, sem callers admin que justifiquem.
