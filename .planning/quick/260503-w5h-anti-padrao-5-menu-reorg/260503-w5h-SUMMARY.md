---
slug: anti-padrao-5-menu-reorg
status: complete
commit: 7e8b4ba
date: 2026-05-03
---

# Summary — Menu reorg (anti-padrão 5)

## O que foi feito

Refatoração do `apps/web/app/app/layout.tsx` (1 arquivo, +56/-49):

- Renomeadas constantes: `NAV` → `CRM_NAV`; `ADMIN_NAV` → `CONFIG_NAV`; `OPS_NAV` mantido.
- `Métricas` movida do bloco admin pro array `OPS_NAV` (último item).
- Label do `/app/leads` mudou de `"CRM"` pra `"Leads"` (a section agora se chama CRM).
- Extraído sub-componente local `NavSection({ label, items, collapsed, pathname, first })` — eliminou 3 cópias do bloco header+map.
- Render no `<nav>` reduzido a 3 chamadas paralelas com role gates: `CRM` (todos), `Operação` (supervisor+), `Configuração` (admin).

## Estrutura final

| Section | Role | Itens |
|---------|------|-------|
| CRM | todos | Dashboard, Inbox, Leads, Campanhas, Agendamentos, Captação |
| Operação | supervisor+ | Cobranças, Fila Corretor, Alertas SLA, Métricas |
| Configuração | admin | Agentes, Funis, Instâncias, Triggers, Fontes, Usuários |

Top bar `Métricas` link permanece intocado (broker continua tendo acesso por lá; preservar UX atual foi decisão consciente).

## Verificação

- `pnpm --filter @pointer/web exec tsc --noEmit` → 0 erros.
- `grep ADMIN_NAV` → vazio. `grep "label: \"CRM\""` → vazio. `grep CRM_NAV/OPS_NAV/CONFIG_NAV/NavSection` → presentes nos sites esperados.
- UI verification real (browser/dev server) **não foi executada** — fica para o usuário validar visualmente.

## Trade-offs

- Brokers ainda acessam Métricas via top bar (link separado do sidebar). Decisão pré-existente, fora do escopo.
- Label "Leads" troca muscle memory de quem clicava em "CRM" — ganho de clareza compensa.
- CRM agora tem header (antes só OPS/Admin tinham). Trade: 12px a mais no topo, ganho de paralelismo visual.

## Commits

- `7e8b4ba` refactor(web): regroup sidebar by entity (CRM / Operação / Configuração)
- (próximo) docs(quick-260503-w5h): plan + summary + STATE update
