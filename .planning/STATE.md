# Pointer CRM — Project Memory

> Estado vivo do projeto. Atualizado a cada quick task / phase.

## Contexto rápido

- **Projeto**: Pointer Imóveis — CRM imobiliário single-tenant com IA no WhatsApp.
- **Stack**: Fastify + Drizzle + BullMQ (api/worker) + Next.js (web) + Postgres + Redis.
- **Modo**: brownfield — `.planning/` foi inicializado tarde, código já em produção.
- **Planejamento de refactor**: 5 anti-padrões identificados em auditoria estrutural. Plano de ataque ordenado registrado em `.planning/quick/20260503-backend-invariants/PLAN.md`.

## Quick Tasks Completed

| Data | Slug | Status | Resumo |
|------|------|--------|--------|
| 2026-05-03 | backend-invariants | ✓ | Anti-padrão 4: POST /leads delega pra ingestLead (lead manual recebe IA) + POST/PATCH /appointments rejeita conflito ±30min |
| 2026-05-03 | anti-padrao-1-service-layer | ✓ | Anti-padrão 1: changeLeadStage (refresca stage_entered_at) + transitionConversationStatus (matriz ai_active↔handed_off→closed) em packages/agent-engine/src/lib; 5 callers migrados (PATCH /leads/stage, POST /leads override, update_stage tool, transfer_to_broker tool, takeover/release) |

## Plano de refactor (5 anti-padrões — ordem de execução)

1. ✅ **Anti-padrão 4** — invariantes no backend
2. ✅ **Anti-padrão 1** — service layer (`changeLeadStage`, `transitionConversationStatus`). `brokerQueueService` descartado (sem callers admin de mutação)
3. ⏳ **Anti-padrão 3** — `domain_events` table + `recordEvent()` chamado dentro dos services
4. ⏳ **Anti-padrão 5** — reorganização do menu por entidade (CRM / Catálogo / Operação / Configuração)
5. ⏳ **Anti-padrão 2** — de-duplicação de UI (Kanban/Lista filtros, Inbox/LeadDetail conversas) — sob demanda

## Mudanças paralelas recentes (não-GSD)

- **Home pública** (apps/web/app/page.tsx): substituída por mirror do site institucional com fetch live em `pointerimoveis.net.br/imoveis/destaqueAjax/` (helpers em `apps/web/lib/featured-properties.ts`).
- **Login redesign** (apps/web/app/login/page.tsx): split layout, marca + form com password toggle.
- **Agent engine** (packages/agent-engine/src/tools/index.ts): `send_property` foi adicionada ao registry. Logs silenciosos em `run.ts:406, 555` foram trocados por `logger.error`.
- **Scripts ops** (apps/api/src/fix_tools.ts, ensure_inbound_and_handoff.ts): atualizados/criados para sincronizar `tools_enabled` e amarrar handoff outbound→inbound.

## Como retomar

- `/gsd-progress` para ver onde paramos.
- Próxima ação recomendada: anti-padrão 3 (`domain_events` table + `recordEvent()` dentro dos services). `/gsd-plan-phase` faz mais sentido aqui — schema novo + integração transacional pede discussão prévia.
