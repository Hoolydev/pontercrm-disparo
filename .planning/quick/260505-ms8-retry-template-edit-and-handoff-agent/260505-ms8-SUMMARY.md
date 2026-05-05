---
slug: retry-template-edit-and-handoff-agent
status: complete
commit: 6c78888
date: 2026-05-05
---

# Summary — Retry dialog: editable template + agent picker

## Pedido

Operador precisa abrir o template da campanha no dialog de reenvio (pra corrigir typo) e escolher o agente que dá continuidade quando o lead responder. Sem quebrar o fluxo atual.

## Entregue

3 mudanças todas opcionais (`commit 6c78888`):

1. **Endpoint** `POST /conversations/retry-failed/preview` → `{ campaigns, uniformTemplate, agents }`.
2. **`retry-failed`** ganha `messageOverrideTemplate?` (re-renderizado por conv com vars `{{name}}`, `{{phone}}`, `{{property_ref}}`, `{{origin}}`, `{{campaign}}` + aliases PT-BR) e `handoffAgentId?` (bulk update em `conversations.agentId`).
3. **RetryModal** carrega preview, mostra template (checkbox `Editar`, textarea, preview readonly), e dropdown de agentes inbound.

Default = comportamento antigo. Quem não tocar nos novos campos vê fluxo idêntico ao de ontem (`b0ede3e`, `b04cd42`, `ab6b923`, etc continuam ativos).

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/web exec tsc --noEmit` → 0 erros.
- Smoke real do user pós-deploy: 3 cenários (não tocar / editar template / escolher agente).

## Pontos importantes preservados

- Substituição de variáveis per-lead — nome/telefone/imóvel certos pra cada um, mesmo no override.
- Validação `handoffAgentId` como inbound active antes de queue messages.
- DISTINCT ON expandido com JOINs (leads, campaigns) sem mudar semântica do batch.
- Sem mexer em `campaigns.first_message_template` — operador edita por reenvio só.

## Commits

- `6c78888` feat(retry): editable template + handoff agent picker on retry dialog
- (próximo) docs(quick-260505-ms8): plan + summary + STATE update
