---
slug: campaign-blast-attachments-fix
status: complete
commit: 14ea5e3
date: 2026-05-04
---

# Summary — Fix: anexos da campanha no blast outbound

## Sintoma

Campanha com vídeo anexado disparava só o texto. Vídeo nunca chegava no lead.

## Raiz

`packages/agent-engine/src/run.ts:213-275` (fast path de first-message no outbound) inseria apenas a row de texto e enfileirava — nunca consultava `campaign_attachments`. `loadContext` carregava os anexos mas só pra system prompt do LLM, e o fast path pula o LLM (otimização).

## Fix

No mesmo fast path, depois do `withLock` que insere o texto:

1. Se `conv.campaignId`, carrega `campaignAttachments` ordenados por `createdAt ASC`.
2. Para cada anexo, insere uma row em `messages` com `mediaUrl=att.url`, `mediaType=att.kind as MediaType`, `content=att.caption ?? ""`, `contentHash = sha256("camp-att:" + conversationId + ":" + att.id)`.
3. Enfileira `outboundMessage` com `delay = textDelay + (i+1) * 3000` e `jobId` deduplicado.
4. Publica pubsub `inbox:updates` por anexo.

3 segundos entre anexos pra não trigger anti-spam do WhatsApp ao mandar mídia em rajada.

`outbound-message.ts` já sabe enviar mídia (`msg.mediaUrl ? provider.sendMedia : provider.sendText`) e o uazapi provider já mapeia `kind→type`/`mediaUrl→file`. Pipeline existente, só faltava criar as rows.

## Verificação

- `pnpm --filter @pointer/agent-engine exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/agent-engine build` → 0 erros.
- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/worker exec tsc --noEmit` → 0 erros.
- Smoke real (precisa do user): rodar campanha-teste com vídeo anexo → lead recebe texto + ~3s depois o vídeo.

## Trade-offs

- Sem flag `send_at_first_touch` por anexo — todos vão. Adicionar UI/schema só se virar dor.
- `agent_attachments` ainda só como contexto do LLM (não dispara). Fora de escopo.
- Falha mid-flight entre insert do texto e dos anexos não retransmite (raro; aceito).
- 3s fixo entre anexos (não usa `pickDelay` random) — previsível, conservador.

## Pendência

Após `pnpm install` ou rebuild de prod: garantir que `packages/agent-engine/dist/` está atualizado (build commitada não é necessária — rebuild no deploy).

## Commits

- `14ea5e3` fix(agent-engine): blast first-touch now ships campaign attachments
- (próximo) docs(quick-260504-eva): plan + summary + STATE update
