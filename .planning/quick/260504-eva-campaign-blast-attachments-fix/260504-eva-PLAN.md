---
slug: campaign-blast-attachments-fix
created: 2026-05-04
mode: gsd-quick
status: draft
---

# Fix: anexos da campanha não enviados no blast outbound

## Sintoma reportado

Campanha de disparo tem vídeo anexado (`campaign_attachments`), mas o vídeo não chega no lead quando o blast roda. Só o texto (first-message template) é enviado.

## Diagnóstico

Caminho do disparo:
1. `apps/worker/src/jobs/outbound-blast.ts` cria a `conversations` row e enfileira `aiReply` com `firstTouch: true`.
2. `packages/agent-engine/src/run.ts:213-275` — fast path de `mode='outbound' && firstTouch && history.length===0 && firstMessageTpl`:
   - Insere UMA `messages` row com `content = renderTemplate(...)`.
   - Enfileira `outboundMessage` com `messageId` + delay.
   - Publica pubsub.
   - **NUNCA consulta `campaign_attachments` nem cria messages adicionais com `mediaUrl`**.
3. `apps/worker/src/jobs/outbound-message.ts:206` já sabe enviar mídia (`msg.mediaUrl ? provider.sendMedia : provider.sendText`).

Por que `loadContext` carrega attachments mas não resolve: ele só injeta os anexos como linhas de texto no system prompt, e isso só importa quando o LLM corre. O fast path PULA o LLM (otimização para evitar custo de inferência no first-touch determinístico). Logo, attachments são invisíveis no caminho de disparo.

## Decisão

No mesmo fast path, depois do texto ser enfileirado, ler `campaign_attachments` da campanha e enfileirar uma `messages` row + `outboundMessage` job por anexo. Cada anexo vira uma mensagem WhatsApp separada (texto + mídia em mensagens distintas é o pattern padrão do `send_property` tool — mesmo padrão).

Confirmações de design (alinhadas com user):
- **Texto primeiro, mídia depois** — ordem natural.
- **Todos os `campaign_attachments`** vão (não há flag de filtro hoje; uso esperado é "todos os anexos da campanha").
- **`agent_attachments` ficam de fora** desse passo — comportamento atual é "anexos do agente são contexto pro LLM", não disparo automático. Pode ser estendido depois.
- Ordem dos anexos: `createdAt ASC` (estável + previsível).

Provider uazapi (`packages/providers/src/uazapi.ts:26`) já implementa `sendMedia` mapeando `kind` → `type` e `mediaUrl` → `file`. Nada a alterar lá.

### Schema mapping

`campaign_attachments.kind` é `text` mas comentário do schema indica `'image' | 'video' | 'document'`. `messages.mediaType` é `MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'`. Passthrough funciona — cast pra `MediaType` é seguro porque o set do source é subset do target.

### Idempotência

- O guard `firstTouch && history.length === 0` previne re-execução do fast path inteiro: após inserir texto + N anexos, a próxima iteração lê history não-vazia e cai no LLM path.
- Se o blast retry mid-flight (depois do texto, antes dos anexos), o segundo run vê `history.length === 1` (texto) e pula o fast path. Anexos NÃO seriam reenviados nesse cenário — perda aceitável e raríssima (worker crash entre insert do texto e insert dos anexos). Caso vire dor real, blindar com idempotency key por anexo é trivial em quick task futura.
- `contentHash`: `sha256("camp-att:" + conversationId + ":" + att.id)` — único por anexo, sobrevive ao dedup-5min de outbound-message.ts:80-96.

### Delay scheduling

BullMQ delay é absoluto (não fila ordenada). Para sequenciar visualmente:
- Texto: delay = `pickDelay({ campaignDelayRange, agentDelayRange })` (D₀, igual hoje).
- Anexo i (0-indexed): delay = D₀ + (i+1) × 3000ms.

3s entre anexos é o mesmo intervalo que `send_property` usa (1500ms — aqui aumentei pra 3s pq blast já tem rate-limit por campanha + risco de banimento WhatsApp se enviar mídias coladas). Conservador.

## Tasks

### Task 1: Estender fast path em `run.ts` para enfileirar anexos da campanha

**Files:**
- `packages/agent-engine/src/run.ts`

**Action:**

Dentro do bloco `if (mode === "outbound" && firstTouch && ctx.history.length === 0 && firstMessageTpl) { ... }`:

1. Após o `withLock(...)` que insere/enfileira o texto fechar, antes do `logger.info` final, adicionar um novo bloco condicional `if (conv.campaignId)`:
   - Carregar `await db.query.campaignAttachments.findMany({ where: eq(schema.campaignAttachments.campaignId, conv.campaignId), orderBy: [asc(schema.campaignAttachments.createdAt)] })`.
   - Se vazio → skip.
   - Para cada anexo (com índice `i`):
     - `mediaMsgId = newId()`.
     - `contentHash = sha256("camp-att:" + conversationId + ":" + att.id)`.
     - `db.insert(schema.messages).values({ id: mediaMsgId, conversationId, direction: "out", senderType: "ai", content: att.caption ?? "", contentHash, mediaUrl: att.url, mediaType: att.kind as MediaType, status: "queued" })`.
     - `getQueues().outboundMessage.add('camp-att-' + mediaMsgId, { messageId: mediaMsgId, conversationId }, { delay: textDelay + (i + 1) * 3000, jobId: 'camp-att-' + mediaMsgId })`.
     - `publisher.publish(CH_INBOX, JSON.stringify({ kind: "message:new", conversationId, messageId: mediaMsgId, senderType: "ai", brokerId: conv.assignedBrokerId }))`.
   - Loop sequential (não Promise.all) — mantém ordem de inserção e logs.

2. Capturar `textDelay` no escopo correto: hoje `delay` é declarado dentro do `withLock` block (linha 246). Mover declaração pra ANTES do `withLock` ou re-calcular após. Decisão: declarar antes (`const textDelay = pickDelay(...)`) e passar pra dentro. Reuso garante texto e anexos compartilham a mesma base.

3. Atualizar `logger.info` final do fast path pra reportar contagem de anexos enviados.

**Imports a adicionar (se necessário):**
- `asc` de `drizzle-orm` (provavelmente já importado — verificar).
- `MediaType` de `@pointer/shared` (apenas se TS reclamar do cast — ideal: cast direto `as MediaType`).

**Verify:**
- `pnpm --filter @pointer/agent-engine exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/agent-engine build` → 0 erros (regenera dist/).
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros (consome dist/).
- `pnpm --filter @pointer/worker exec tsc --noEmit` → 0 erros.
- `grep -n "campaignAttachments" packages/agent-engine/src/run.ts` → 1 hit novo (findMany).
- Code review mental: o ramo só executa quando o fast path executa (template + first touch + sem history). Branches seguros não são tocados.

**Done:**
- 1 arquivo editado.
- Build do agent-engine atualizado pra api/worker enxergarem.

## Trade-offs aceitos

- **Sem flag de "enviar no first-touch"**: hoje o user só configura attachments na UI da campanha. Não há `send_at_first_touch` boolean por anexo. Comportamento implícito: todos vão. Se virar problema (ex: anexo "manual de uso interno" não deveria ir pro lead), filtrar via campo novo é trivial depois.
- **`agent_attachments` continuam só como contexto LLM** — fora do escopo. Quem quer "agente outbound manda PDF junto" pode anexar na campanha em vez do agente.
- **Delay 3s fixo entre anexos** — não usa `pickDelay` (que é random range). Trade: menos "humano", mais previsível. Aceitável para blast (já é máquina).
- **Falha mid-flight não retransmite anexos**: se worker cair entre insert do texto e dos anexos, próximo run pula fast path e os anexos nunca vão. Cenário raro; mitigação seria CTE ou idempotency-by-attachment. Out of scope.
- **Sem teste automatizado**: repo não tem suite. Verificação fica em typecheck + smoke manual do user (envio real numa campanha de teste com vídeo).

## Verificação

- Typechecks limpos nos 3 pacotes (agent-engine, api, worker).
- Após o user aplicar a build e rodar uma campanha-teste com vídeo: lead recebe (1) texto do template, (2) ~3s depois, vídeo. Comportamento esperado.

## Out of scope

- Anexos do `agent_attachments` no blast (precisa decisão de produto separada).
- Flag `send_at_first_touch` por anexo na UI de campanha.
- Reordenação manual dos anexos (UI atual ordena por createdAt).
- Idempotency por anexo (CTE ou unique constraint).
- Update da UI de campanha para confirmar visualmente "este anexo será enviado no disparo".
