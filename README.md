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

Login de demonstração criado pelo seed: `demo@naescuta.com.br` / `NaEscuta#2026`.

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
