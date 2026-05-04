---
slug: retry-failed-batch-rewrite
created: 2026-05-04
mode: gsd-quick
status: complete
---

# Fix: retry-failed gateway timeout em massa (964 convs)

## Sintoma

UI travava em "Agendando…" sem nunca voltar quando o user pediu reenvio das 964 mensagens falhadas. Console do navegador mostrava erros de gateway timeout.

## Raiz

`apps/api/src/routes/conversations.ts:198-250` rodava um loop sequencial fazendo POR conversa:
1. `findFirst` em `conversations` (ver se existe)
2. `findFirst` em `messages` (última falhada)
3. `insert` em `messages` (nova queued)
4. `update` condicional em `conversations` (sticky instance)
5. `outboundMessage.add` no BullMQ

= 5 round-trips por conv × 964 = ~6.000 ops em série. Cada Neon roundtrip ~30-100ms → ~150s no melhor caso. Gateway (Railway/Vercel/CF) corta em 30-60s. Request nunca volta → mutation client fica `isPending: true` infinito.

## Decisão

Reescrever como batch:

1. **Uma query** com `selectDistinctOn` pegando última msg falhada por conv + stickyInstance da conv (substitui 2N findFirsts).
2. **Bulk insert** de todas as messages novas em uma statement (substitui N inserts).
3. **Updates agrupados por instance** — uma UPDATE por instância ativa (≤ instances.length, tipicamente 2-5), não por conv.
4. **`queue.addBulk`** com todos os jobs em uma chamada (substitui N adds).

Resultado: ~3-5 ops totais em vez de ~6.000. Tempo cai de ~150s pra ~1-2s.

## Tasks

### Task 1: substituir loop por batch em retry-failed

**Files:**
- `apps/api/src/routes/conversations.ts`

**Action:**
Aplicado conforme decisão acima. Detalhes da implementação:
- `db.selectDistinctOn([messages.conversationId], {...}).from(messages).innerJoin(conversations, ...).where(inArray(conversationIds) AND status='failed').orderBy(conversationId, desc(createdAt))`.
- Filtra `eligible = candidates.filter(c => !!c.content)` em JS (defensivo — query já tem WHERE status='failed' mas content NULL é teoricamente possível).
- Atribui instance round-robin por índice em `eligible` (não por índice no `conversationIds` original — empates de skipped não atrapalham).
- `stickyChanges: Record<instanceId, convId[]>` agrupa convs cujo whatsappInstanceId vai mudar. Loop emite UPDATE por grupo via `inArray`.
- `addBulk(jobs)` com `name: retry-${msgId}` (sem colon — alinhado com fix `41f6ad3`) e `jobId: retry-${msgId}`.

**Verify:**
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- Smoke do user: rodar reenvio com 1-2 convs primeiro. Se finaliza em <2s → testar 964.

**Done:**
- 1 arquivo editado, 60 inserções / 42 deleções.
- Sem mudança de schema, sem mudança de contrato HTTP (mesmos campos no response).

## Trade-offs aceitos

- **Sticky instance ainda é setada**, mas em batch. Comportamento preservado.
- **Round-robin por índice em `eligible`** — convs que foram filtradas (sem failed message) não consomem turno do round-robin. Resultado: distribuição mais justa entre instances do que antes.
- **`addBulk` em uma chamada** com 964 jobs — BullMQ gerencia internamente via Lua script chunked. Se virar gargalo (milhares de retries), chunkar em batches de 200 é trivial.
- **Sem chunked SELECT** — `inArray(conversationIds)` com 964 IDs vira IN com 964 params. Postgres aceita até ~32k params; folga grande.
- **Sem retry/transaction wrapper** — se o INSERT em massa falhar, não há rollback. Aceito porque (a) jobs ainda não foram enqueueados, (b) cliente recebe erro e pode retentar, (c) idempotência via UNIQUE em messages.id já protege.

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0.
- Validação real: user testa com 1-2 convs primeiro, depois com batch maior.

## Out of scope

- Mover pra background job (worker dedicado pra processar retry queue) — overkill se batch resolve.
- UI de progresso (streaming/SSE) — só faz sentido se voltar a estourar timeout em volume maior que 5k.
- Idempotência forte por `(conversationId, retry-batch-id)` — não há sintoma reportado de retry duplicado.
