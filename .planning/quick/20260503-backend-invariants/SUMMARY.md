---
slug: backend-invariants
status: complete
completed: 2026-05-03
mode: gsd-quick
phase: 1
parent-plan: anti-padrao-4-backend-invariants
---

# Backend invariants — execução

## O que mudou

### `apps/api/src/routes/leads.ts`
- `POST /leads` agora delega para `ingestLead()` em vez de inserir a row na mão.
  - Cria `lead` + `conversation` (status `ai_active`, mode `inbound`) + enfileira `aiReply` job (firstTouch).
  - Honra `brokerId` e `pipelineStageId` explícitos via UPDATE pós-ingest.
  - Mantém `metadataJson.manual = true`.
  - Resposta: `{ id, conversationId, isNew }` (antes era só `{ id }`).
- Removidos imports não usados: `newId`, `pickBroker`, `resolveDefaultStageId`. Adicionados: `getQueues`, `ingestLead`.

### `apps/api/src/routes/appointments.ts`
- Helper novo: `findConflictingAppointment(db, brokerId, scheduledFor, ignoreId?)` — janela ±30min, só compara contra status `scheduled` e `confirmed`.
- `POST /appointments`: se há `targetBroker`, checa conflito antes do INSERT. Conflito → `409` com payload `{ message, conflictWith: { id, scheduledFor, status } }`.
- `PATCH /appointments/:id`: re-checa conflito quando reschedule, troca de broker, ou reativação fariam o appointment cair em janela ativa com broker. Mesmo `409`.

## Verificação automática
- `tsc --noEmit -p apps/api` → limpo.

## Verificação manual pendente (UAT)
1. **Lead manual recebe IA**: criar lead via UI/curl → confirmar que `conversation` foi criada, aparece no inbox, e `aiReply` job processou first-touch. Logs do worker devem mostrar `engine: turn complete`.
2. **Conflito em POST**: agendar visita às 14:00 pro broker X → tentar segunda às 14:15 → esperar `409 Conflict`. Cancelar a primeira → tentar de novo → deve passar.
3. **Conflito em PATCH**: criar duas appts em horários distantes → mover a segunda pra dentro da janela da primeira → esperar `409`.
4. **Sem broker**: criar appointment sem `brokerId` (ou broker null) → não deve disparar conflito (não tem como conflitar). 

## Trade-offs aceitos
- Janela de ±30min é hardcoded. Próxima iteração (service layer no Anti-padrão 1) move pra config.
- `metadataJson` pós-update sobrescreve qualquer metadata que `ingestLead` deixou (no caso manual, ingestLead não tinha metadata interessante porque payload é mínimo). Aceitável.
- 409 não é tratado pelas telas atuais — UI apenas mostraria erro genérico. Item de UX pra phase futura.

## Próximo passo
Anti-padrão 1: extrair `leadService`, `conversationService`, `brokerQueueService` com invariantes (ex.: `stageEnteredAt` auto-atualizado em `changeStage`). Recomendo aguardar o `/clear` antes de iniciar pra contexto limpo.
