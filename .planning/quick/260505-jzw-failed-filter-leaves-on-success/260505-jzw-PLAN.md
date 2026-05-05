---
slug: failed-filter-leaves-on-success
created: 2026-05-05
mode: gsd-quick
status: complete
---

# Falhadas filter: usar última msg outbound visível, não EXISTS

## Sintoma

Após `ENCRYPTION_KEY` ser corrigido no Railway worker, retries começaram a sair pelo WhatsApp normalmente. Mas o conv ainda aparece no filtro "Falhadas" do inbox mesmo depois de mandar a mensagem com sucesso.

## Raiz

`apps/api/src/routes/conversations.ts:40-44` (predicate) e `:51-60` (count) usavam:

```sql
EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.status = 'failed')
```

Isso é "tem QUALQUER msg failed". Como a row failed antiga continua no DB, conv nunca sai do filtro mesmo após sucesso.

## Decisão

Predicate semântico: **"a última msg outbound visível é failed"**.

```sql
(SELECT m.status FROM messages m
 WHERE m.conversation_id = c.id
   AND m.direction = 'out'
   AND m.status <> 'queued'
 ORDER BY m.created_at DESC
 LIMIT 1) = 'failed'
```

Excluir `status='queued'` alinha com o filtro UI (commit `b99b51d`) que esconde queued do chat — assim "última visível" é o que o operador vê na tela.

Comportamento:
- Conv com [failed] → latest é failed → IN Falhadas ✓
- Conv com [failed, sent] → latest é sent → OUT Falhadas ✓ (o que o user quer)
- Conv com [failed, queued] → queued ignorado, latest visível é failed → IN Falhadas (correto: retry ainda em flight, conv ainda precisa de atenção)
- Conv com [sent, failed] (raro, ex: provider derrubou meio-fluxo) → latest é failed → IN Falhadas ✓

## Tasks

### Task 1: Trocar predicate + count em conversations.ts

**Files:** `apps/api/src/routes/conversations.ts`

**Action:** Substituir o `EXISTS` em 2 lugares:
- `if (onlyFailed)` predicate
- `failedCountRow` query

Por subquery `LIMIT 1` que pega o status da última msg outbound não-queued.

**Verify:** `pnpm --filter @pointer/api exec tsc --noEmit` → 0.

**Done:** Conv leaves Falhadas assim que `messages.status='sent'` (ou delivered/read) for inserted.

## Trade-offs aceitos

- **Subquery por linha** no SELECT principal: Postgres planeja como nested loop ou hash, e tem index `messages_conversation_created_idx (conversation_id, created_at)` (ver `packages/db/src/schema/messages.ts:33-36`) → cada subquery é um seek. Custo aceitável até dezenas de milhares de convs.
- **`onlySent` mantido com EXISTS**: user só pediu fix do Falhadas. Enviadas mantém semântica antiga ("alguma vez foi enviada"). Se aparecer queixa simétrica, ajustamos.
- **Mensagens inbound não contam**: filtro é só sobre outbound. Lead respondendo com algo após uma falha NÃO tira a conv de Falhadas (o operador ainda precisa reenviar a mensagem original).

## Verificação

- Typecheck limpo.
- Smoke real (após deploy): conversas que reenviaram com sucesso devem desaparecer do filtro "Falhadas". Badge deve refletir o número correto.

## Out of scope

- Aplicar o mesmo padrão na "Enviadas" — separado, se virar pedido.
- Filtro "Em fila" (queued ativo) — não pedido.
- UI auto-refresh do contador depois de mandar — ChatPane invalida queryKey ao receber pubsub `inbox:updates`. Já funciona.
