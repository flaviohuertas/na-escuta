# Na Escuta — Plano e Arquitetura

Sistema de gestão para produtoras de eventos, com offline-first real. Este documento descreve a arquitetura implementada, o modelo de dados, o protocolo de sincronização, os riscos conhecidos e o estado atual do projeto — atualizado incrementalmente a cada etapa.

## 1. Status desta entrega (honestidade sobre o que existe)

Esta é a **primeira fatia funcional** (autenticação, isolamento por empresa/evento, eventos (leitura), tarefas, checklists, ocorrências (com evidências) e o motor de sincronização offline-first completo — outbox, conflitos, bootstrap, recuperação de falhas) **mais o Painel gerencial** (módulo 1, ver abaixo). Os demais módulos do enunciado (CRM, orçamentos, financeiro, contratos, fornecedores, equipes, estoque, logística, credenciamento/QR, comunicação, riscos, pós-evento, relatórios, administração) **não estão implementados** — ver seção 10. Nenhuma tela demonstrativa foi criada para eles.

**Painel gerencial (`/painel`) — módulo 1, parcial.** Portfólio de eventos por fase (em andamento / próximos / encerrados / cancelados), semáforo de saúde por evento com os motivos explicados (ocorrência crítica ou grave aberta, tarefa atrasada ou bloqueada, item obrigatório de checklist pendente perto do evento), KPIs agregados só sobre eventos ativos, e agenda dos próximos 14 dias (início/término de evento + prazos de tarefa, com atrasadas agrupadas no topo). Regras puras em `src/lib/domain/dashboard.ts`; consultas agregadas (`groupBy`) em `src/server/dashboard/dashboard.service.ts`; UI em `src/components/dashboard/DashboardView.tsx`. É um Server Component ao vivo, como `/eventos` — **exige conexão**, e a tela exibe o horário em que foi calculada para que um retrato antigo servido pelo cache do Service Worker fique visível. Ainda **não** tem: filtros, visão de calendário mensal, KPIs financeiros (não há módulo financeiro), nem visão de "todas as tarefas da empresa". Datas da agenda são agrupadas em `America/Sao_Paulo`, não no fuso do servidor.

**O que está implementado E testado** (124 testes unitários, `npm run test`, sem depender de Postgres — usam `fake-indexeddb` para simular IndexedDB e um `caches`/Service Worker falsos; 77 deles vieram desta rodada: Painel, `EventWorkspace`, telas offline (`warm-routes`, `sw-warm`, `routes`), `AppLink`, retentativa de conectividade e conflitos — vários com regressão comprovada, ou seja, falham sem a correção; ver seção 13):
- Motor de sincronização: outbox atômica, coalescência de edições, backoff exponencial, aplicação de push/pull, detecção e preservação de conflito, recuperação de operações presas após fechar o app no meio do envio, resposta parcial do servidor, reenvio idempotente.
- Repositórios (tarefas/checklists/ocorrências/evidências): gravação local + outbox na mesma transação Dexie, com teste explícito de rollback atômico.
- Sessão offline: verificação de assinatura EdDSA, âncora de relógio monotônica (não é enganada só adiantando o relógio do sistema).
- Fluxo "preparar evento para uso offline": manifesto de contagens, download paginado, verificação pós-download.
- Exportação cifrada (AES-GCM/PBKDF2) das alterações pendentes.
- Monitoramento de quota/persistência de armazenamento.

**Validado contra Postgres real e navegador real** (Postgres 18.4 via `embedded-postgres`, sem Docker; Edge, build de produção — ver seção 11): a migration inicial aplica limpa; o seed roda; os **20 testes de integração** (`npm run test:integration`) passam — push/idempotência, conflitos (detecção, resolução, 409 com entidade, autorização), isolamento entre empresas e as consultas do Painel. Os **5 specs E2E** (`tests/e2e/`) passam, e foram repetidos em 3 rodadas seguidas, inclusive com o banco acumulando dados (15/15): preparar evento, abrir e recarregar **sem rede**, criar tarefa/checklist/ocorrência offline, fechar e reabrir, reconectar sem duplicar, conflito entre dois dispositivos resolvido manualmente, sessão expirada. Login e `/painel` foram abertos no navegador (desktop e mobile). `npm run build`, `npm run lint` e `npm run typecheck` passam limpos.

**Limites conhecidos do uso offline — leia antes de prometer "offline" a alguém** (detalhes na seção 13): (a) o detalhe de um checklist/ocorrência **criado offline** não abre offline (medido: página de erro do navegador) — o id novo não tem HTML guardado; (b) `/eventos` (catálogo), `/painel` e `/conflitos` exigem conexão e, sem ela, mostram a página de erro do navegador (não há tela de fallback); (c) offline, cada troca de tela recarrega a página (ver `AppLink`).

## 2. Arquitetura

```
prisma/schema.prisma          modelo de dados Postgres
prisma/migrations/            migration inicial (gerada via `prisma migrate diff`, sem precisar de DB ativo)
src/generated/prisma/         Prisma Client gerado (driver adapter, não versionado)

src/app/
  (public)/login/             tela de login (Server Action + Auth.js Credentials)
  (app)/                      shell autenticado — layout valida sessão e monta SyncProvider
    painel/                   Painel gerencial: portfólio, saúde e agenda (Server Component, Postgres ao vivo — exige conexão)
    eventos/                  catálogo (Server Component, busca no Postgres — exige conexão)
    eventos/[eventId]/        workspace do evento — 100% client-side, lê do Dexie, funciona offline
      tarefas/ checklists/ ocorrencias/   telas operacionais (Dexie puro, sem Server Action)
    conflitos/                 resolução manual e auditada de conflitos (exige conexão)
    configuracoes/sincronizacao/  status de sync, quota, eventos preparados
  api/auth/                   Auth.js + emissão do grant offline (EdDSA)
  api/sync/                   push/pull/bootstrap/conflitos — sempre revalidam permissão no servidor

src/lib/
  domain/            schemas Zod compartilhados (cliente + servidor) — única fonte de validação; dashboard.ts = regras puras do Painel
  db/dexie/           schema IndexedDB (Dexie): entidades espelhadas + outbox + syncState + session + conflicts
  db/prisma.ts        singleton do Prisma Client (driver adapter @prisma/adapter-pg)
  sync/                motor: ids.ts, outbox.ts, engine.ts, connectivity.ts, protocol.ts, bootstrap.ts, export-pending.ts
  auth/                offline-session.ts (verificação EdDSA + âncora monotônica), device-id.ts, auth.config.ts
  repositories/        CRUD local — grava entidade + outbox na MESMA transação Dexie
  storage/persistence.ts  quota e persistência de armazenamento
  offline/             telas do evento sem rede: routes.ts (o que cachear), warm-routes.ts (lado da página), sw-warm.ts (lado do SW), navigate.ts

src/server/
  sync/                serviços: authorize.ts, push.service.ts, pull.service.ts, bootstrap.service.ts, conflict.service.ts, entity-schemas.ts (filtro Zod por entidade, compartilhado por push e resolução de conflito)
  dashboard/           dashboard.service.ts — agregações do Painel (exige Membership E EventAccess ativos, igual a authorizeEventAccess)
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
- **Aplicação local** (`src/lib/sync/engine.ts`): `applyPullResponse`/`applyPushResponse` rodam dentro de uma única transação Dexie. Pull nunca sobrescreve uma entidade com edição local que o servidor ainda não aceitou: outbox `PENDING`/`SENDING` **ou `CONFLICT`**. (Antes, um `CONFLICT` era dado por "superado" assim que um pull trazia a versão do servidor — e o pull do mesmo ciclo do push trazia exatamente essa versão, então a edição offline era apagada sem a pessoa nunca ver a tela de conflitos; ver seção 13.) Só a resolução explícita fecha um conflito.
- **Retomada após interrupção:** operações presas em `SENDING` (app fechou no meio do envio) voltam para `PENDING` ao reabrir. Reenviar uma operação já aplicada retorna `DUPLICATE_IGNORED` (PK = operationId no servidor) — nunca duplica.
- **Resposta parcial:** operações enviadas sem resultado correspondente na resposta (servidor caiu no meio do lote) voltam para `PENDING` com backoff, tratadas na mesma sessão, não só na próxima abertura do app.
- **Conflito:** detectado comparando `baseVersion` do cliente com `version` atual no servidor (qualquer divergência conta — mesmo que os dois lados tenham escolhido o mesmo valor). Nunca sobrescreve — cria um registro em `Conflict` com as duas versões completas, exposto em `/conflitos` para resolução manual (`KEEP_SERVER`/`KEEP_CLIENT`/`MERGED`), sempre auditada em `AuditLog` (quem resolveu, quando, qual estratégia). O `clientPayload` guardado é o objeto local cru do dispositivo; ao aplicá-lo (`KEEP_CLIENT`/`MERGED`) o servidor o passa pelo mesmo schema Zod do push (`src/server/sync/entity-schemas.ts`), que descarta campos que só existem no aparelho. Depois de resolver, o dispositivo converge com a entidade que o servidor devolve (`src/lib/sync/conflict-resolution.ts`) — inclusive em `KEEP_SERVER`, em que a entidade do servidor não muda e o pull nunca a traria de volta. Resolver um conflito que outro dispositivo já resolveu devolve **409 com a entidade atual**, e o app converge com ela e avisa.
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
3. **Telas do evento sem rede** (`src/worker/service-worker.ts`, Serwist; `src/lib/offline/*`): precache dos chunks JS/CSS do build + uma regra própria `NetworkFirst` (timeout 4s) para os **documentos HTML** de `/eventos/[id]/*` e `/configuracoes/sincronizacao` (`na-escuta-pages-v1`; só 200 sem redirecionamento; 7 dias). **Só ativo em produção** (`next build && next start`) — desligado em `next dev` de propósito. Ao "Preparar evento", a página **pede ao Service Worker** (`postMessage`) que busque e guarde as 5 telas do evento e depois **confirma no Cache Storage** que entraram; só então o selo vira "Disponível offline". Pedir ao SW (em vez de `fetch()` na página) é necessário porque, na primeira carga, o SW pode estar ativo sem controlar a página. O selo é lido do Cache Storage a cada abertura ("Telas não guardadas" + botão para guardar de novo se o navegador limpou o cache). O logout apaga tudo que é do usuário (`clearUserScopedCaches`) — o HTML guardado carrega nome e dados do evento.
   - `AppLink` (`src/components/ui/AppLink.tsx`) substitui `next/link` em todo o app: **offline**, o clique vira navegação de documento (servida pelo SW). A soft navigation do Next offline falha o RSC, cai em "browser navigation" e é abortada em loop pelos prefetches que também falham.
   - `reloadOnOnline: false` no `next.config.ts`: o padrão do Serwist recarrega a página a cada evento `online`, o que num app de campo (sinal oscilando) perderia o que a pessoa está digitando e abortava a navegação acima.
4. **IDs client-side** (UUIDv7) — nunca esperam o servidor.
5. **Atomicidade**: toda gravação local (`createTask`, `setChecklistItemStatus`, `addOccurrenceEvidence` etc.) grava a entidade E enfileira a outbox na mesma transação Dexie — testado explicitamente com injeção de falha (rollback comprovado).
6. **Sincronização disparada**: ao abrir o app, ao recuperar conectividade (evento `online` do browser + ping ativo contra `/api/health`, não só `navigator.onLine`) e por comando manual (`SyncProvider.syncNow`) — nunca depende só de Background Sync.
7. **Estados visíveis**: por registro — pendente/sincronizando/sincronizado/conflito/erro (`SyncStatusBadge`); globalmente — indicador online/offline + contagem de pendências (`SyncStatusBar`).
8. **Detecção de conectividade**: `ConnectivityMonitor` faz um ping ativo a `/api/health` — não confia só em `navigator.onLine`. Se o ping falha mas o navegador diz que há rede, **tenta de novo com backoff** (2s, 4s… até 30s); antes, um único ping malsucedido logo após o `online` deixava o app preso em "Offline" com "Sincronizar agora" desabilitado, sem saída.

## 8. Limitações documentadas

- **A primeira utilização em cada dispositivo exige conexão** — login, obtenção do grant offline e a primeira preparação de um evento não têm caminho totalmente offline (não há como seria diferente sem comprometer a segurança).
- **Dispositivos offline não compartilham alterações entre si** até que cada um sincronize individualmente com o servidor — dois dispositivos offline editando o mesmo evento só "se veem" depois que ambos reconectarem.
- **O navegador pode remover os dados armazenados** sob pressão de espaço, mesmo com `navigator.storage.persist()` concedido (concessão não é garantia absoluta).
- **Suporte offline não é idêntico em todos os navegadores** — Safari no iOS é historicamente mais agressivo ao descartar dados do IndexedDB do que Chrome/Edge; PWAs "instaladas" via "Adicionar à Tela de Início" no iOS têm comportamento de armazenamento diferente de uma aba normal do Safari.
- Esses quatro pontos estão visíveis para o usuário final na tela `/configuracoes/sincronizacao`, não só aqui.
- **Evidências (fotos) ficam local ao dispositivo nesta fatia** — só os metadados sincronizam (ver seção 6). Um dispositivo perdido/apagado antes de um upload de binário implementado no futuro perde o arquivo, não o registro de que ele existiu.
- **Offline, só abrem as telas guardadas** — as 5 do evento preparado. Checklist/ocorrência **criados offline** não abrem o detalhe offline (id novo, sem HTML guardado); `/eventos` (catálogo), `/painel` e `/conflitos` exigem conexão. Ver seção 13.

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
| 1 (parcial) | Painel gerencial: portfólio, saúde por evento, agenda de 14 dias | **Implementado e validado**: lógica (unitário), consultas contra Postgres real (integração) e página no navegador (Edge, dados de seed) — faltam filtros, calendário mensal e KPIs financeiros (dependem de módulos ainda inexistentes) |
| 3 (parcial) | Eventos (leitura), Tarefas | **Implementado e testado (unitário)** |
| 11 (parcial) | Ocorrências e evidências (metadados) | **Implementado e testado (unitário)** |
| 2, 3 (resto), 4–10, 12–17 | CRM/propostas, escopo/cronograma completo, orçamentos, financeiro, contratos, fornecedores, equipes, estoque, logística, credenciamento/QR, comunicação, riscos/segurança, pós-evento, relatórios, administração/integrações | **Planejados, não iniciados** — cada um reaproveita o motor de sync, o modelo de auditoria (`AuditLog`) e o padrão `PendingApproval` já existentes; nenhuma tela demonstrativa foi criada antes da funcionalidade real |

Próximo passo recomendado: **fechar o último buraco do uso offline — abrir offline o detalhe de checklist/ocorrência criados offline (seção 13, item 1)** — e só então empilhar novos módulos. O restante da promessa central (trabalhar em campo sem internet) já está provado no navegador (E2E 5/5). Depois, CRM/propostas (módulo 2), na ordem do enunciado.

## 11. Como rodar e testar

Ver [`README.md`](../README.md).

**Sem Docker (Windows/dev):** um Postgres real pode ser rodado com o pacote npm `embedded-postgres` (binários oficiais do Postgres), instalado fora do projeto. Pontos que custaram tempo descobrir:
- O arquivo de config do Prisma se chama `prisma7.config.ts` (não `prisma.config.ts`): passe `--config prisma7.config.ts` (`npx prisma migrate deploy --config prisma7.config.ts`).
- O `.env` do dev pode apontar para outro banco (ex.: `prisma dev`). Variável de ambiente já definida **vence** o `.env` — exporte `DATABASE_URL`/`TEST_DATABASE_URL` para o banco de teste antes de rodar seed, testes de integração ou `next start`, para nunca tocar no banco de desenvolvimento.
- `npm run test:integration` roda os arquivos em série (`fileParallelism: false` no `vitest.config.ts`): todos compartilham um banco e cada teste faz `TRUNCATE`; em paralelo apareciam violações de FK aleatórias.
- E2E: a porta 3000 pode já estar ocupada por um `next dev`; use `next start -p <outra> ` com `AUTH_URL` correspondente. Sem baixar o Chromium do Playwright, dá para usar o Edge instalado (`channel: "msedge"`).

## 12. Decisões e premissas registradas

- npm como gerenciador de pacotes (único disponível no ambiente de desenvolvimento desta sessão).
- Rotas em português (`/eventos`, `/conflitos`, `/configuracoes/sincronizacao`) — melhor UX para o público-alvo, divergência deliberada do esboço inicial em inglês do plano de implementação.
- `/eventos` (catálogo) é Server Component buscando no Postgres; as páginas dentro de um evento específico são Client Components lendo do Dexie — ver seção 2.
- A página inicial pós-login continua sendo `/eventos` (não `/painel`): trocar exigiria mexer no redirect do login, na raiz, no `start_url` do manifest e no helper de login do E2E, que não pude executar aqui. `/painel` é o primeiro item do menu; promover a landing é uma decisão de produto barata de fazer depois.
- Saúde do evento é uma heurística explícita (`computeEventHealth`), não um indicador oficial: os limiares (ex.: 48h para exigir checklist obrigatório fechado) são constantes nomeadas em `dashboard.ts` e devem ser revisados com quem opera eventos.
- Credenciamento/QR (módulo 12) fica fora desta fatia; nenhuma tabela foi criada agora para evitar acoplamento prematuro.
- Dados de seed são fictícios e claramente identificados como tal (`prisma/seed.ts`).
- UI de resolução de conflitos oferece `KEEP_SERVER`/`KEEP_CLIENT`; a API também suporta `MERGED` (edição manual de campo a campo), mas o editor de merge na UI ainda não foi construído — fora do escopo desta primeira fatia.

## 13. Achados da validação contra banco e navegador reais

Primeira vez que a pilha completa (Postgres real + build de produção + Edge) foi exercitada. O que apareceu:

**Corrigido nesta rodada**
- **`EventWorkspace` travava em "Carregando…" para qualquer evento ainda não baixado** — o caminho de primeiro uso, o que mostra o botão "Preparar para uso offline", era inalcançável. Causa: `useLiveQuery` devolve `undefined` enquanto carrega, e `events.get()` de id ausente também resolve `undefined`. Corrigido normalizando para `null`; regressão coberta em `tests/unit/components/event-workspace.test.tsx` (comprovado: falha sem a correção). `OccurrenceDetailScreen` tem uma variante menor do mesmo padrão (id inexistente fica em "Carregando…"); não corrigida — não bloqueia fluxo.
- **A confirmação da preparação sumia antes de ser vista:** o botão era desmontado quando o evento chegava ao Dexie. Agora a tela mantém o botão montado durante a transição e exibe o selo persistente "Disponível offline" (ou "Preparação incompleta").
- Helpers/specs E2E com defeitos próprios (seletor do primeiro link pegava o logo do menu; checagem do botão antes da hidratação; asserção vazia no spec de conflito — `getByText("Conflito")` casava com o link "Conflitos" do menu e escondia o bug de perda de dados abaixo) e `fileParallelism` dos testes de integração.
- Menu lateral cortava o botão "Sair" no mobile.
- **Offline: o Service Worker não guardava o HTML das telas do evento.** A regra de HTML do `defaultCache` do Serwist casa pelo header `Content-Type` da *requisição*, que navegações nunca enviam — nunca disparava. Recarregar ou abrir `/eventos/[id]/*` sem rede dava `ERR_FAILED`. Corrigido com regra própria + aquecimento na preparação (seção 7, item 3). Três causas encadeadas apareceram até fechar: (i) o aquecimento feito por `fetch()` da página falhava de forma **intermitente** quando o SW estava ativo mas sem controlar a página (2 em 6 execuções) — agora quem busca é o próprio SW; (ii) `reloadOnOnline` (padrão do Serwist) recarregava a página em cada `online` oscilante e abortava a navegação; (iii) o clique em `<Link>` offline era abortado em loop pelo roteador do Next (→ `AppLink`).
- **Conectividade: o app podia ficar preso em "Offline" para sempre.** Sem nova tentativa após um ping falho, e com "Sincronizar agora" desabilitado offline, a pessoa não tinha como pedir outro teste. Agora há retentativa com backoff.
- **PERDA SILENCIOSA DE DADOS em conflitos (a mais grave).** O push devolvia `CONFLICT` e, no pull do mesmo ciclo, o motor sobrescrevia a cópia local com a versão do servidor e dava o conflito por "superado": a edição offline sumia e a tela de conflitos nunca aparecia. Isso contradizia a regra central do produto ("nunca sobrescreve silenciosamente"). Corrigido (seção 4); regressão em `tests/unit/sync/engine.test.ts` (comprovado: os 3 testes falham sem a correção com "expected 'Versão do servidor' to be 'Editado offline'").
- **"Manter minha versão" nunca funcionava**: o `clientPayload` guardado é o objeto local cru (com `syncStatus`…) e o Prisma recusava o campo (`Unknown argument syncStatus`). Agora passa pelo schema do push. O teste de integração antigo usava payload limpo e por isso nunca pegou (o novo usa o payload real; comprovado que reproduz o erro sem a correção).
- **"Manter o servidor" deixava a cópia local com o valor descartado** e o selo "conflito" para sempre (a entidade do servidor não muda, então o pull nunca a traz). O 409 "já resolvido" agora devolve a entidade atual — depois de checar autorização, para não vazar dado — e o app converge com ela.

**Aberto**
1. **Detalhe de checklist/ocorrência criados offline não abre offline** (medido: página de erro do navegador). O id é gerado no cliente e a URL `/checklists/[id]` não tem HTML guardado; o Next não consegue renderizar uma rota dinâmica nova sem servidor. **Decisão de arquitetura pendente:** o desenho que resolve de forma robusta é servir o detalhe numa rota fixa com o id na query (`/checklists/detalhe?id=…`, `/ocorrencias/detalhe?id=…`) — a página é client-side e lê do Dexie, então o HTML guardado da rota fixa serve para qualquer id (com `ignoreSearch` no cache). Isso muda URLs hoje "bookmarkáveis" (`/checklists/[id]`); vale combinar antes.
2. **`/eventos`, `/painel` e `/conflitos` sem conexão** mostram a página de erro do navegador. Falta uma tela de fallback ("esta tela precisa de internet — abra um evento preparado").
3. `OccurrenceDetailScreen` tem uma variante menor do bug do `EventWorkspace` (id inexistente fica em "Carregando…").
4. `KEEP_CLIENT` em conflito de uma operação `DELETE`: o `clientPayload` de um delete não carrega dados para aplicar; o comportamento não foi tratado nem testado.
5. O editor de merge campo a campo (`MERGED`) segue sem UI.

**Placar (Edge, build de produção, Postgres real):** unitários 124 · integração 20 · E2E 5/5 (3 rodadas seguidas, 15/15).
