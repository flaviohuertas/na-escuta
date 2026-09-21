# Na Escuta

Sistema de gestão para produtoras de eventos, com suporte **offline-first real**: depois de autenticado e com um evento "preparado", tarefas, checklists e ocorrências continuam funcionando sem internet, sincronizando com segurança quando a conexão volta.

Arquitetura completa, modelo de dados, protocolo de sincronização, riscos e roteiro dos módulos: veja [`docs/PLANO.md`](docs/PLANO.md).

## Stack

Next.js (App Router) + React + TypeScript · Tailwind CSS · PostgreSQL + Prisma (driver adapter `@prisma/adapter-pg`) · Dexie (IndexedDB) · Service Worker via Serwist · Zod compartilhado · Vitest + Playwright · Docker Compose.

## Pré-requisitos

- Node.js ≥ 20
- Docker Desktop (para o Postgres local)

## Configuração inicial

```bash
npm install

cp .env.example .env
npm run keys:generate   # gera o par de chaves EdDSA do grant offline — copie a saída para o .env
# gere também um AUTH_SECRET, ex.: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

docker compose up -d
npx prisma migrate deploy   # aplica a migration já gerada em prisma/migrations/
npm run db:seed             # cria empresa/usuário/evento de demonstração (dados fictícios)
```

Logins de demonstração criados pelo seed (mesma senha, `NaEscuta#2026`):
- `demo@naescuta.com.br` — titular da empresa e gestora do evento (vê tudo, inclusive **Equipe** e as telas de gestão);
- `equipe@naescuta.com.br` — papel restrito (equipe de campo): serve para ver e testar o que quem não é gestor enxerga.

**Depois de atualizar o código, aplique as migrations e regenere o client** (o Prisma Client gerado não é versionado):
`npm run db:migrate:deploy && npm run db:generate`. As migrations `20260919160000_user_must_change_password` e `20260920120000_user_session_version` são necessárias para o login e para a leitura de qualquer sessão; `20260920190000_pending_approval_relations` é necessária para o fluxo de aprovação (`/aprovacoes`); `20260920210000_crm_clients_opportunities` é necessária para o comercial (`/comercial`); `20260920230000_proposals` é necessária para as propostas comerciais (`/comercial/propostas`); `20260920233000_budgets` é necessária para o orçamento interno (a seção "Orçamento interno" da oportunidade — **sem ela a tela da oportunidade quebra ao abrir**); `20260921000000_event_expenses` é necessária para o financeiro (`/financeiro`, só titular e administração); `20260921010000_suppliers` é necessária para os fornecedores (`/fornecedores`) **e** para o orçamento e o financeiro, que passam a ler o vínculo com o cadastro (sem ela as telas de orçamento e de lançamento quebram).

## Rodando localmente

```bash
npm run dev
```

Abre em `http://localhost:3000`. **O Service Worker fica desligado em modo dev de propósito** (evita cache obsoleto durante o desenvolvimento) — para testar o comportamento offline de verdade, use um build de produção:

```bash
npm run build   # usa webpack explicitamente: o Serwist ainda não suporta Turbopack para o build do Service Worker
npm run start
```

## Testes

```bash
npm run test              # unitários — não dependem de Postgres (fake-indexeddb simula o IndexedDB)
npm run test:integration  # exige Postgres real rodando (docker compose up -d && prisma migrate deploy)
npm run test:e2e          # Playwright — exige build de produção + Postgres + `npx playwright install`
npm run typecheck
npm run lint
```

## Estrutura

```
prisma/schema.prisma        modelo de dados (Postgres)
prisma/migrations/          migration inicial (gerada sem precisar de DB ativo — prisma migrate diff)
src/app/                    rotas (App Router) — (public)/login, (app)/eventos/..., api/auth, api/sync
src/lib/domain/             schemas Zod compartilhados (cliente + servidor)
src/lib/db/dexie/           schema IndexedDB (Dexie) — outbox, syncState, session, conflicts
src/lib/db/prisma.ts        singleton do Prisma Client (driver adapter Postgres)
src/lib/repositories/       CRUD local (Dexie) — grava entidade + outbox na mesma transação
src/lib/sync/               motor de sincronização (outbox, engine, connectivity, bootstrap, protocol)
src/lib/auth/                autenticação + sessão offline (EdDSA, âncora de relógio monotônica)
src/server/sync/             serviços server-side de push/pull/bootstrap/conflitos (revalidam permissão sempre)
src/components/              UI (React, Tailwind)
src/worker/service-worker.ts  Service Worker (Serwist)
tests/unit/                  Vitest + fake-indexeddb — rodam sem Postgres
tests/integration/            Vitest contra Postgres real — não rodam sem Docker
tests/e2e/                    Playwright — não rodam sem Docker + browsers instalados
```

## Limitações conhecidas desta entrega

Ver a seção "Limitações documentadas" em [`docs/PLANO.md`](docs/PLANO.md) para a lista completa (navegadores, quota, primeiro uso exige conexão, etc.) e o roteiro dos módulos ainda não implementados.
