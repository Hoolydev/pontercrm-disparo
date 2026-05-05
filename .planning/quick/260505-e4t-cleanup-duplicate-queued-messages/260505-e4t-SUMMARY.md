---
slug: cleanup-duplicate-queued-messages
status: complete
commit: 52926f0
date: 2026-05-05
---

# Summary — cleanup duplicate queued messages

## Sintoma

Conversas no inbox com 3+ mensagens idênticas em `status='queued'`, sobras dos cliques múltiplos no retry-failed antes do fix de batch (`b0ede3e`).

## Solução

Script ops em `apps/api/src/cleanup_duplicate_queued.ts`:

- SQL com `ROW_NUMBER() OVER (PARTITION BY conversation_id, content_hash ORDER BY created_at ASC)` — mantém a mais antiga.
- Dry-run default; flag `--execute` deleta.
- Best-effort remove BullMQ jobs por prefixo (`retry-`, `ai-send-`, `prop-`, `camp-att-`).
- Bulk DELETE em chunks de 1000 ids.

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- Smoke real precisa do user rodar o script.

## Como rodar

```bash
export DATABASE_URL='postgres://...'    # Neon prod
export REDIS_URL='redis://...'          # Railway Redis prod

# Dry run
pnpm --filter @pointer/api exec tsx src/cleanup_duplicate_queued.ts

# Executa
pnpm --filter @pointer/api exec tsx src/cleanup_duplicate_queued.ts --execute
```

## Pendência aberta

Mensagens marcadas `status='sent'` que não chegaram no WhatsApp — bug separado (provavelmente provider devolveu 200 mas a instância estava desconectada; uazapi cai no fallback `uazapi-${Date.now()}` quando não tem messageId real). Reportar se persistir.

## Commits

- `52926f0` chore(ops): script to clean up duplicate queued messages
- (próximo) docs(quick-260505-e4t): plan + summary + STATE update
