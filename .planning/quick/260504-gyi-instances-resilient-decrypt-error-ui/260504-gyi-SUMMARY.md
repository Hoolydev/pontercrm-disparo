---
slug: instances-resilient-decrypt-error-ui
status: complete
commit: 8b09921
date: 2026-05-04
---

# Summary — Instances resilient decrypt + error UI

## Sintoma

`/app/instances` ficava eternamente "Carregando…"; clicar em "Nova instância" deixava tela em branco.

## Raiz mais provável

GET `/whatsapp-instances` em `apps/api/src/routes/instances.ts:20-32` chamava `decryptJson` por row sem try/catch. Uma row com `configJson` corrompido derrubava a lista inteira (500). Frontend não tinha branch `isError` → ficava preso em loading.

## Fix

- **Backend** (`apps/api/src/routes/instances.ts`): try/catch por row. Falha vira `{ __error: "decryption_failed" }`; resto da lista carrega + `app.log.warn` registra qual row falhou.
- **Frontend** (`apps/web/app/app/instances/page.tsx`): branch `isError` com card vermelho + mensagem + botão "Tentar novamente".

## Verificação

- `pnpm --filter @pointer/api exec tsc --noEmit` → 0 erros.
- `pnpm --filter @pointer/web exec tsc --noEmit` → 0 erros.
- Smoke real precisa do user: acessar `/app/instances` e validar.

## Pendência aberta

"Tela em branco no clique de Nova instância" — sem console do navegador não consigo localizar. Se persistir após o deploy:
1. Abrir DevTools → Console no momento do clique
2. Copiar mensagem de erro vermelha
3. Reportar pra próxima quick task

## Commits

- `8b09921` fix(instances): per-row decrypt try/catch + visible error UI
- (próximo) docs(quick-260504-gyi): plan + summary + STATE update
