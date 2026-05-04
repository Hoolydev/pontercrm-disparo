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
| 2026-05-03 | anti-padrao-3-domain-events | ✓ | Anti-padrão 3: tabela `domain_events` (audit log durável) + `recordEvent()` chamado em changeLeadStage / transitionConversationStatus / recordBrokerAssignment. Migration 0010 NÃO aplicada no Neon — pendência do usuário. |
| 2026-05-03 | anti-padrao-5-menu-reorg | ✓ | Anti-padrão 5: sidebar reagrupado em 3 sections (CRM / Operação / Configuração) com role gates; Métricas migra Admin→Operação; label /app/leads vira "Leads". Top bar Métricas preservada. |
| 2026-05-04 | campaign-blast-attachments-fix | ✓ | Bug: blast outbound fast path em run.ts não enviava `campaign_attachments` (vídeo da campanha nunca chegava). Fix: depois do texto, enfileira N rows de mídia (uma por anexo), com delay textDelay + (i+1)*3000ms. |

## Plano de refactor (5 anti-padrões — ordem de execução)

1. ✅ **Anti-padrão 4** — invariantes no backend
2. ✅ **Anti-padrão 1** — service layer (`changeLeadStage`, `transitionConversationStatus`). `brokerQueueService` descartado (sem callers admin de mutação)
3. ✅ **Anti-padrão 3** — `domain_events` audit log + `recordEvent()` em changeLeadStage / transitionConversationStatus / recordBrokerAssignment. Migration 0010 pendente de apply no Neon.
4. ✅ **Anti-padrão 5** — sidebar reagrupado em 3 sections (CRM / Operação / Configuração). Catálogo absorvido em CRM (1-2 itens não justificavam section própria).
5. ⏭️ **Anti-padrão 2** — descartado conscientemente em 2026-05-03. Auditoria mostrou ~140 linhas de duplicação real (types Lead/Stage inline em list/kanban, fetch + stage select duplicados entre LeadDetailDrawer e /app/leads/[id]/page). Sem sintoma reportado e o usuário precisa preservar o comportamento atual das views de leads (controle granular de outbound enviado vs falho). Reabrir só se aparecer divergência funcional (ex: filtro mudou em uma view e não na outra, ou drawer/page mostram campos diferentes).

## Mudanças paralelas recentes (não-GSD)

- **Home pública** (apps/web/app/page.tsx): substituída por mirror do site institucional com fetch live em `pointerimoveis.net.br/imoveis/destaqueAjax/` (helpers em `apps/web/lib/featured-properties.ts`).
- **Login redesign** (apps/web/app/login/page.tsx): split layout, marca + form com password toggle.
- **Agent engine** (packages/agent-engine/src/tools/index.ts): `send_property` foi adicionada ao registry. Logs silenciosos em `run.ts:406, 555` foram trocados por `logger.error`.
- **Scripts ops** (apps/api/src/fix_tools.ts, ensure_inbound_and_handoff.ts): atualizados/criados para sincronizar `tools_enabled` e amarrar handoff outbound→inbound.

## Como retomar

- `/gsd-progress` para ver onde paramos.
- **Refactor de anti-padrões encerrado** em 4/5 (anti-padrão 2 descartado conscientemente — ver nota acima). Não há próxima fase pendente do plano.
- **Pendência crítica para deploy**: aplicar migration 0010 no Neon antes de subir o backend (`pnpm --filter @pointer/db migrate` ou rodar SQL direto). Sem isso, qualquer mutação via service nos 3 sites integrados vai falhar com "relation domain_events does not exist".
- **Verificação UI pendente**: rodar dev server e validar visualmente o sidebar reagrupado (anti-padrão 5) como admin/supervisor/broker.
