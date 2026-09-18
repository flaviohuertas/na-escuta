# Na Escuta — Plano e Arquitetura

Sistema de gestão para produtoras de eventos, com offline-first real. Este documento descreve a arquitetura implementada, o modelo de dados, o protocolo de sincronização, os riscos conhecidos e o estado atual do projeto — atualizado incrementalmente a cada etapa.

## 1. Status desta entrega (honestidade sobre o que existe)

Esta é a **primeira fatia funcional**: autenticação, isolamento por empresa/evento, eventos (leitura), tarefas, checklists, ocorrências (com evidências), e o motor de sincronização offline-first completo (outbox, conflitos, bootstrap, recuperação de falhas). Os demais 12+ módulos do enunciado (CRM, orçamentos, financeiro, contratos, fornecedores, equipes, estoque, logística, credenciamento/QR, comunicação, riscos, pós-evento, relatórios, administração) **não estão implementados** — ver seção 11. Nenhuma tela demonstrativa foi criada para eles.

**O que está implementado E testado nesta sessão** (47 testes unitários, `npm run test`, sem depender de Postgres — usam `fake-indexeddb` para simular IndexedDB):
- Motor de sincronização: outbox atômica, coalescência de edições, backoff exponencial, aplicação de push/pull, detecção e preservação de conflito, recuperação de operações presas após fechar o app no meio do envio, resposta parcial do servidor, reenvio idempotente.
- Repositórios (tarefas/checklists/ocorrências/evidências): gravação local + outbox na mesma transação Dexie, com teste explícito de rollback atômico.
- Sessão offline: verificação de assinatura EdDSA, âncora de relógio monotônica (não é enganada só adiantando o relógio do sistema).
- Fluxo "preparar evento para uso offline": manifesto de contagens, download paginado, verificação pós-download.
- Exportação cifrada (AES-GCM/PBKDF2) das alterações pendentes.
- Monitoramento de quota/persistência de armazenamento.

**O que está implementado mas NÃO pôde ser testado nesta sessão** (ambiente sandbox sem Docker/Postgres — decisão registrada com o usuário no início): as rotas de API e serviços server-side (`src/server/sync/*`), o schema Prisma e a migration, o seed, e os testes de integração/E2E escritos em `tests/integration/` e `tests/e2e/` (aguardando `docker compose up`). O `npm run build` (produção, com webpack) e `npm run lint`/`npm run typecheck` passam limpos, incluindo essas rotas — a compilação e os tipos foram verificados, mas não o comportamento real contra um banco.

**Verificado nesta sessão via `next dev`/`next build`, sem banco:** app shell renderiza, roteamento e proteção de rotas autenticadas funcionam (redirecionamento para `/login`), formulário de login e tratamento de erro de credenciais funcionam ponta a ponta, build de produção gera o Service Worker corretamente com webpack.

## 2. Arquitetura

```
prisma/schema.prisma          modelo de dados Postgres
prisma/migrations/            migration inicial (gerada via `prisma migrate diff`, sem precisar de DB ativo)
src/generated/prisma/         Prisma Client gerado (driver adapter, não versionado)

src/app/
  (public)/login/             tela de login (Server Action + Auth.js Credentials)
  (app)/                      shell autenticado — layout valida sessão e monta SyncProvider
    eventos/                  catálogo (Server Component, busca no Postgres — exige conexão)
    eventos/[eventId]/        workspace do evento — 100% client-side, lê do Dexie, funciona offline
      tarefas/ checklists/ ocorrencias/   telas operacionais (Dexie puro, sem Server Action)
    conflitos/                 resolução manual e auditada de conflitos (exige conexão)
    configuracoes/sincronizacao/  status de sync, quota, eventos preparados
  api/auth/                   Auth.js + emissão do grant offline (EdDSA)
  api/sync/                   push/pull/bootstrap/conflitos — sempre revalidam permissão no servidor

src/lib/
  domain/            schemas Zod compartilhados (cliente + servidor) — única fonte de validação
  db/dexie/           schema IndexedDB (Dexie): entidades espelhadas + outbox + syncState + session + conflicts
  db/prisma.ts        singleton do Prisma Client (driver adapter @prisma/adapter-pg)
  sync/                motor: ids.ts, outbox.ts, engine.ts, connectivity.ts, protocol.ts, bootstrap.ts, export-pending.ts
  auth/                offline-session.ts (verificação EdDSA + âncora monotônica), device-id.ts, auth.config.ts
  repositories/        CRUD local — grava entidade + outbox na MESMA transação Dexie
  storage/persistence.ts  quota e persistência de armazenamento

src/server/
  sync/                serviços: authorize.ts, push.service.ts, pull.service.ts, bootstrap.service.ts, conflict.service.ts
  auth/offline-grant.service.ts   emissão do JWT EdDSA do grant offline

src/components/        UI React (Tailwind), organizada por domínio (tasks/, checklists/, occurrences/, sync/, auth/, layout/)
src/worker/service-worker.ts   Service Worker (Serwist) — precache do app shell + runtime caching
```

**Regra de fronteira aplicada em todo o código:** nenhuma tela sob `eventos/[eventId]/{tarefas,checklists,ocorrencias}` chama Server Action ou depende de resposta do servidor para ler ou gravar — tudo passa por `lib/repositories/*` (Dexie puro). Server Actions e rotas de API existem só para autenticação e sincronização. A listagem de eventos (`/eventos`) é a exceção deliberada: é um catálogo buscado ao vivo no Postgres (exige conexão a primeira vez, como documentado) — uma vez que um evento é "preparado", a própria página do evento (`/eventos/[eventId]` e as telas abaixo dela) passa a funcionar inteiramente do IndexedDB, sem depender mais dessa listagem.

## 3. Modelo de dados

### Servidor (Prisma/Postgres)

Toda entidade operacional sincronizável tem: `version Int @default(1)`, `createdAt`/`updatedAt`, `createdBy`/`updatedBy`, `deletedAt DateTime?` (tombstone — nunca delete físico imediato).

- **Identidade e permissão:** `User`, `Company` (com `offlineAccessDays`), `Membership` (papel por empresa: OWNER/ADMIN/PRODUCER/STAFF/FREELANCER/VIEWER), `EventAccess` (papel por evento: MANAGER/FIELD_STAFF/VIEWER, com `status ACTIVE|REVOKED`), `Device` (grant offline por dispositivo, revogável).
- **Domínio operacional:** `Event`, `Task`, `ChecklistTemplate` + `ChecklistItem`, `Occurrence` + `OccurrenceEvidence`.
- **Sincronização e auditoria:** `SyncOutboxLog` (chave primária = operationId do cliente → garante idempotência), `Conflict` (entidade própria — guarda as duas versões, estratégia de resolução, quem resolveu e quando), `AuditLog` (genérico, reusado por todos os módulos futuros).
- **Reuso futuro:** `PendingApproval` — padrão genérico de "proposta pendente" para quando módulos financeiros/contratos/estoque existirem (schema já criado, não usado nesta fatia — evita retrabalho estrutural).

### Cliente (Dexie/IndexedDB)

Tabelas espelhando as entidades operacionais + infraestrutura de sync:
- `outbox`: `id` (UUIDv7, chave de idempotência), `baseVersion`, `payload`, `status` (PENDING/SENDING/SENT/FAILED/CONFLICT), `attempts`, `nextAttemptAt` (backoff), `lastError`.
- `syncState`: cursor de paginação por evento, `lastFullBootstrapAt`, `expectedCounts` (do manifesto de bootstrap).
- `session`: grant offline (JWT, snapshot de permissões, âncora de relógio monotônica).
- `conflicts`: espelho local dos conflitos pendentes/resolvidos.

IDs de entidade são gerados no **cliente** via **UUIDv7** (não ULID): cabe nativamente numa coluna `uuid` do Postgres, mantém ordenação temporal (bom para os cursores de sync baseados em `updatedAt+id`), sem lib extra além do `uuid` já usado.

## 4. Protocolo de sincronização

- **Push** (`POST /api/sync/push`): lote de operações da outbox (id = idempotência, baseVersion, payload). Resposta por operação: `APPLIED | CONFLICT | REJECTED | DUPLICATE_IGNORED`.
- **Pull** (`GET /api/sync/pull?eventId&cursor`): mudanças incrementais via keyset pagination por tipo de entidade (cursor opaco em base64 guardando `{updatedAt, id}` por tipo — evita reenviar tudo e nunca pula registros com `updatedAt` empatado).
- **Bootstrap** (`GET /api/sync/bootstrap?eventId`): manifesto com contagem esperada por tipo + primeira página de dados + o snapshot do próprio Evento (que não é uma entidade sincronizável via outbox nesta fatia — sem edição offline de Evento). O cliente aplica a primeira página e continua paginando pelo pull normal até esgotar, depois **verifica** que a contagem local bate com o manifesto — só então marca o evento como "preparado".
- **Aplicação local** (`src/lib/sync/engine.ts`): `applyPullResponse`/`applyPushResponse` rodam dentro de uma única transação Dexie. Pull nunca sobrescreve uma entidade com outbox pendente (`PENDING`/`SENDING`); ao aplicar uma versão mais nova por pull, qualquer outbox `CONFLICT` da mesma entidade é limpa (o conflito foi superado) e o registro local do conflito é marcado como resolvido.
- **Retomada após interrupção:** operações presas em `SENDING` (app fechou no meio do envio) voltam para `PENDING` ao reabrir. Reenviar uma operação já aplicada retorna `DUPLICATE_IGNORED` (PK = operationId no servidor) — nunca duplica.
- **Resposta parcial:** operações enviadas sem resultado correspondente na resposta (servidor caiu no meio do lote) voltam para `PENDING` com backoff, tratadas na mesma sessão, não só na próxima abertura do app.
- **Conflito:** detectado comparando `baseVersion` do cliente com `version` atual no servidor. Nunca sobrescreve — cria um registro em `Conflict` com as duas versões completas, exposto em `/conflitos` para resolução manual (`KEEP_SERVER`/`KEEP_CLIENT`/`MERGED`), sempre auditada em `AuditLog` (quem resolveu, quando, qual estratégia).
- **Coalescência local:** edições sucessivas do MESMO dispositivo na mesma entidade antes de sincronizar se fundem numa única operação pendente (preserva o `baseVersion` original) — evita autoconflito. Um CREATE ainda pendente seguido de DELETE local cancela a operação e apaga o registro fisicamente (nunca saiu do dispositivo, nada a sincronizar).
- **Servidor sempre revalida:** toda escrita passa por `authorizeEventAccess` (Membership + EventAccess ativos) e checagem de papel (`roleCanWrite`) no servidor — nunca confia no que o grant offline do cliente dizia no momento em que foi emitido.

## 5. Autenticação e sessão offline

Auth.js v5 (Credentials + bcrypt), sessão web em JWT. Para uso offline: fluxo explícito de **Offline Grant** (`POST /api/auth/offline-grant`, exige sessão web válida) — o servidor assina um JWT **EdDSA (Ed25519)** com um retrato das permissões do usuário (papel na empresa + acesso por evento) e validade de `Company.offlineAccessDays` dias.

Verificação local (`src/lib/auth/offline-session.ts`): assinatura EdDSA checada com a chave pública embutida no bundle (não é segredo). Validade calculada com uma **âncora de relógio monotônica** (`lastVerifiedServerTime + (performance.now() - monotonicAnchorMs)`), não `Date.now()` puro — adiantar o relógio do sistema operacional não estende trivialmente o acesso offline. **Limitação residual documentada:** reiniciar o processo do navegador entre trocas de relógio ainda pode escapar dessa checagem; não é uma garantia criptográfica de tempo, só uma barreira prática razoável.

Rotas de sync **sempre** revalidam a sessão web normal (cookie do Auth.js) — o grant offline nunca autoriza escrita no servidor, só autoriza o app a abrir e operar localmente. Se a sessão web expirou, push/pull retornam 401 e a UI mostra o erro sem perder a outbox local.

Revogação: `Membership`/`EventAccess` com `status REVOKED` são detectados no próximo push/pull e aplicados — acesso é removido e a outbox pendente daquele escopo é rejeitada com motivo explícito (`MEMBERSHIP_REVOKED`/`EVENT_ACCESS_REVOKED`), nunca aplicada silenciosamente.

## 6. Segurança, permissões e minimização de dados

- Isolamento por empresa: todo dado tem `companyId`; toda query server-side de sync passa por `authorizeEventAccess`, que confirma Membership ativo na empresa do evento.
- Isolamento por evento: `EventAccess` controla quem vê/edita cada evento especificamente (um usuário pode ter acesso a alguns eventos da empresa e não a outros).
- Auditoria genérica (`AuditLog`) em toda escrita (CREATE/UPDATE/DELETE/CONFLICT_RESOLVED), com `metadata` guardando `syncOperationId`/`deviceId`.
- Minimização: o pacote "preparado" de um evento só inclui os dados daquele evento (tarefas, checklists, ocorrências, metadados de evidência) — não a base inteira da empresa. Evidências (fotos) ficam com o **binário local ao dispositivo** nesta fatia; só os metadados (nome, tipo, tamanho, checksum SHA-256, data de captura) sincronizam — upload real do binário é um adaptador futuro explícito, nunca fingido como concluído.
- Logout (`LogoutButton`): avisa quantas alterações estão pendentes, oferece exportação cifrada (AES-GCM-256, chave derivada via PBKDF2/SHA-256 com 210 mil iterações — recomendação OWASP 2023) antes de permitir limpar o dispositivo (`wipeLocalDatabase`), e também permite sair sem apagar nada.
- Emissão fiscal, pagamentos, assinatura eletrônica e mensagens externas: fora do escopo desta fatia (nenhum desses módulos existe ainda); quando implementados, devem seguir o padrão já estabelecido aqui — nunca simular sucesso sem credenciais reais, sempre um adaptador explicitamente identificado como simulado.

## 7. Offline-first: o que funciona e como

1. **Preparar evento para uso offline** (`src/lib/sync/bootstrap.ts`, `PrepareOfflineButton`): baixa dados autorizados do evento com barra de progresso (fases: iniciando → baixando → verificando → concluído/erro) e verificação pós-download contagem por contagem contra o manifesto do servidor. Só marca como "preparado" (`syncState.lastFullBootstrapAt`) se todas as contagens baterem.
2. **Leituras e gravações operacionais**: 100% contra Dexie, nunca esperam rede (repositórios em `src/lib/repositories/*`).
3. **Cache de shell** (`src/worker/service-worker.ts`, Serwist): precache do app shell + runtime caching stale-while-revalidate para navegação/assets — permite abrir e recarregar telas já visitadas sem conexão. **Só ativo em produção** (`next build && next start`) — desligado em `next dev` de propósito para não cachear código em desenvolvimento.
4. **IDs client-side** (UUIDv7) — nunca esperam o servidor.
5. **Atomicidade**: toda gravação local (`createTask`, `setChecklistItemStatus`, `addOccurrenceEvidence` etc.) grava a entidade E enfileira a outbox na mesma transação Dexie — testado explicitamente com injeção de falha (rollback comprovado).
6. **Sincronização disparada**: ao abrir o app, ao recuperar conectividade (evento `online` do browser + ping ativo contra `/api/health`, não só `navigator.onLine`) e por comando manual (`SyncProvider.syncNow`) — nunca depende só de Background Sync.
7. **Estados visíveis**: por registro — pendente/sincronizando/sincronizado/conflito/erro (`SyncStatusBadge`); globalmente — indicador online/offline + contagem de pendências (`SyncStatusBar`).
8. **Detecção de conectividade**: `ConnectivityMonitor` faz um ping ativo a `/api/health` — não confia só em `navigator.onLine`.

## 8. Limitações documentadas

- **A primeira utilização em cada dispositivo exige conexão** — login, obtenção do grant offline e a primeira preparação de um evento não têm caminho totalmente offline (não há como seria diferente sem comprometer a segurança).
- **Dispositivos offline não compartilham alterações entre si** até que cada um sincronize individualmente com o servidor — dois dispositivos offline editando o mesmo evento só "se veem" depois que ambos reconectarem.
- **O navegador pode remover os dados armazenados** sob pressão de espaço, mesmo com `navigator.storage.persist()` concedido (concessão não é garantia absoluta).
- **Suporte offline não é idêntico em todos os navegadores** — Safari no iOS é historicamente mais agressivo ao descartar dados do IndexedDB do que Chrome/Edge; PWAs "instaladas" via "Adicionar à Tela de Início" no iOS têm comportamento de armazenamento diferente de uma aba normal do Safari.
- Esses quatro pontos estão visíveis para o usuário final na tela `/configuracoes/sincronizacao`, não só aqui.
- **Evidências (fotos) ficam local ao dispositivo nesta fatia** — só os metadados sincronizam (ver seção 6). Um dispositivo perdido/apagado antes de um upload de binário implementado no futuro perde o arquivo, não o registro de que ele existiu.
- **Sem Docker/Postgres neste ambiente de desenvolvimento**: rotas server-side, migration e seed não foram exercitadas contra um banco real nesta sessão — ver seção 1.

## 9. Riscos técnicos e mitigações

| Risco | Mitigação |
|---|---|
| Eviction agressiva do IndexedDB no Safari iOS | `requestPersistentStorage()` + aviso na UI + `isEventPreparedOffline` força reverificação, nunca assume dado presente |
| Update remoto chegando com edição local pendente | Pull nunca sobrescreve entidade com outbox `PENDING`/`SENDING`; conflito fica visível, nunca some |
| Quota estourada por evidências/fotos | Monitoramento de quota (`getStorageStatus`/`isNearQuotaLimit`) com aviso ao usuário perto do limite |
| Duas abas do mesmo dispositivo rodando o motor de sync ao mesmo tempo | `runFullSyncCycleLocked` usa a Web Locks API (`navigator.locks`), com fallback direto se a API não existir |
| Migração de schema Dexie em produção | Versionamento incremental do Dexie (`db.version(n).stores(...)`), a ser testado com `fake-indexeddb` quando a v2 existir |
| Token offline com relógio do dispositivo manipulado | Assinatura EdDSA (não forjável sem a chave privada) + âncora monotônica; limitação residual documentada na seção 5 |
| Vazamento entre empresas (tenants) | `authorizeEventAccess` obrigatório em todo serviço server-side; testes de integração dedicados em `tests/integration/api/tenant-isolation.integration.test.ts` (não executados nesta sessão — requerem Postgres) |
| Prisma 7 / next-auth v5 ainda em fases iniciais de major/beta | Versões fixadas exatas (`7.10.0` / `5.0.0-beta.32`, sem `^`) para não puxar a v8 RC do Prisma nem uma beta mais nova do next-auth sem revisão deliberada |
| `@serwist/next` ainda não suporta Turbopack para o build do Service Worker | `npm run build` usa `next build --webpack` explicitamente (ver `package.json`) — confirmado gerando `public/sw.js` corretamente |
| TypeScript 7 (nativo) ainda incompatível com `typescript-eslint` (`<6.1.0` no momento desta entrega) | Fixado `typescript@6.0.3` (não `^`) para manter lint funcionando; revisar quando `typescript-eslint` suportar TS 7 |

## 10. Roteiro dos 17 módulos

| # | Módulo | Status |
|---|---|---|
| — | Auth, isolamento por empresa/evento, auditoria, motor de sync | **Implementado e testado (unitário)** |
| 3 (parcial) | Eventos (leitura), Tarefas | **Implementado e testado (unitário)** |
| 11 (parcial) | Ocorrências e evidências (metadados) | **Implementado e testado (unitário)** |
| 1, 2, 3 (resto), 4–10, 12–17 | Painel/agenda/portfólio, CRM/propostas, escopo/cronograma completo, orçamentos, financeiro, contratos, fornecedores, equipes, estoque, logística, credenciamento/QR, comunicação, riscos/segurança, pós-evento, relatórios, administração/integrações | **Planejados, não iniciados** — cada um reaproveita o motor de sync, o modelo de auditoria (`AuditLog`) e o padrão `PendingApproval` já existentes; nenhuma tela demonstrativa foi criada antes da funcionalidade real |

Próximo passo recomendado: retomar pelo Painel gerencial/agenda/portfólio (módulo 1) e CRM/propostas (módulo 2), na ordem do enunciado.

## 11. Como rodar e testar

Ver [`README.md`](../README.md).

## 12. Decisões e premissas registradas

- npm como gerenciador de pacotes (único disponível no ambiente de desenvolvimento desta sessão).
- Rotas em português (`/eventos`, `/conflitos`, `/configuracoes/sincronizacao`) — melhor UX para o público-alvo, divergência deliberada do esboço inicial em inglês do plano de implementação.
- `/eventos` (catálogo) é Server Component buscando no Postgres; as páginas dentro de um evento específico são Client Components lendo do Dexie — ver seção 2.
- Credenciamento/QR (módulo 12) fica fora desta fatia; nenhuma tabela foi criada agora para evitar acoplamento prematuro.
- Dados de seed são fictícios e claramente identificados como tal (`prisma/seed.ts`).
- UI de resolução de conflitos oferece `KEEP_SERVER`/`KEEP_CLIENT`; a API também suporta `MERGED` (edição manual de campo a campo), mas o editor de merge na UI ainda não foi construído — fora do escopo desta primeira fatia.
