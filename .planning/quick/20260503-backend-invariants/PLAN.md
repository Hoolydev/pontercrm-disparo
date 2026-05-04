---
slug: backend-invariants
created: 2026-05-03
mode: gsd-quick
status: in-progress
---

# Backend invariants — Anti-padrão 4 (passo 1 do plano de refactor)

## Contexto

Auditoria estrutural identificou 5 anti-padrões raiz no Pointer CRM. O passo 1 do plano (Anti-padrão 4) corrige bugs latentes sem comprometer arquitetura — boa rampa para validar o ciclo dev/typecheck antes de mexer no service layer.

### Bugs alvo

**Bug 1 — Lead manual entra mudo**
- `POST /leads` (apps/api/src/routes/leads.ts:105) cria a row em `leads` mas **não cria a `conversation` nem enfileira `aiReply`** como o webhook ZAP faz via `ingestLead()` (apps/api/src/lib/lead-ingest.ts:42).
- Resultado: lead criado pela UI fica sem first-touch da IA — operação assume que IA respondeu e ele só fica esperando.

**Bug 2 — Agendamento aceita conflito de horário**
- `POST /appointments` (apps/api/src/routes/appointments.ts:109) não checa se o broker já tem outro `scheduled`/`confirmed` na mesma janela. UI pode até validar, mas qualquer integração externa (ou IA via tool) fura.

## Decisões

1. **POST /leads delegará para `ingestLead()`** (mesmo helper do webhook) e, se vier `brokerId` ou `pipelineStageId` explícitos, aplica override pós-ingest. Mantém `metadataJson.manual = true`.
2. **POST e PATCH de `/appointments`** ganham helper `assertNoApptConflict(db, brokerId, scheduledFor, ignoreId?)`. Janela: ±30min. Só compara contra `status IN ('scheduled', 'confirmed')`. Retorna 409 se houver overlap.

## Trade-offs aceitos

- ingestLead já roda round-robin de broker; o override depois pode parecer redundante, mas mantém o contrato do endpoint manual (admin escolheu corretor X — respeitar).
- ±30min é hardcoded por enquanto. Próximo passo (service layer) vai mover pra config por agente/broker.

## Verificação

- `tsc --noEmit -p apps/api` limpo.
- Re-checagem manual: criar lead pela UI → conversa aparece no inbox e IA responde.
- Re-checagem manual: tentar agendar 2 visitas no mesmo broker às 14:00 e 14:15 → segunda dá 409.

## Out of scope

- Anti-padrões 1, 2, 3, 5 — ficam para próximas quick tasks ou phases.
- Validação de PATCH /leads/:id/stage atualizando `stageEnteredAt` — esse é problema do Anti-padrão 1 (service layer).
