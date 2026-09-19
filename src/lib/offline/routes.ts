/**
 * Quais telas o Service Worker guarda para abrir sem rede.
 *
 * Só telas que NÃO dependem do servidor para renderizar: as páginas de um evento
 * (`/eventos/[id]/...`) são Client Components que leem do IndexedDB, então o HTML
 * guardado + os chunks do precache bastam para abri-las offline. Ficam de fora
 * de propósito o catálogo `/eventos`, `/painel` e `/conflitos` (leem o Postgres
 * ao vivo — um retrato guardado seria enganoso), `/login` e `/api/*`.
 *
 * Este módulo é importado pelo Service Worker E pelo app; mantenha-o sem
 * dependências (nada de React, Dexie ou `@/`-alias — o SW é empacotado à parte).
 */

/** Cache do SW para os documentos HTML acima. O prefixo versionado permite trocar o formato sem herdar lixo. */
export const OFFLINE_PAGES_CACHE_NAME = "na-escuta-pages-v1";

/**
 * Mensagem página → Service Worker: "busque e guarde estas telas". O SW faz a busca, em vez
 * de a página fazer `fetch()` e torcer para o SW interceptar — na primeira carga o SW pode
 * estar ativo sem ter assumido o controle da página (o documento foi criado depois do
 * `clients.claim()`), e nesse caso as requisições da página nem passam por ele.
 */
export const WARM_ROUTES_MESSAGE = "NA_ESCUTA_WARM_ROUTES";

/** Prefixo dos caches de pré-cache do Serwist (assets do build, não contêm dado de usuário). */
export const PRECACHE_NAME_PREFIX = "serwist-precache";

/**
 * LISTA EXPLÍCITA das telas do evento que funcionam sem servidor: o evento, tarefas, checklists,
 * ocorrências e os dois detalhes (rota fixa com o id na query). Não é "tudo sob /eventos/":
 * `/eventos/novo`, `/eventos/[id]/editar` e as telas de administração são renderizadas no servidor
 * para quem pode usá-las, exigem conexão para salvar e não devem ficar guardadas — uma cópia
 * velha do formulário de edição, ou de uma tela de acessos, enganaria e envelheceria dados.
 * Tela nova sob `/eventos/` fica FORA do cache até ser incluída aqui de propósito.
 */
const EVENT_SCREEN_PATH =
  /^\/eventos\/(?!novo(?:\/|$))[^/]+(?:\/(?:tarefas|checklists|ocorrencias)(?:\/detalhe)?)?$/;

export function isOfflineCacheablePath(pathname: string): boolean {
  return EVENT_SCREEN_PATH.test(pathname) || pathname === "/configuracoes/sincronizacao";
}

/**
 * Tela mostrada quando não há rede e a página pedida não está guardada (ex.: `/painel`, que
 * lê o Postgres ao vivo). É PRÉ-CARREGADA pelo Service Worker ao instalar — na tela de login,
 * sem sessão — então precisa ser pública: se exigisse login, o pré-cache receberia um
 * redirecionamento e a instalação inteira do SW falharia.
 */
export const OFFLINE_FALLBACK_URL = "/offline";

/**
 * Detalhe de checklist/ocorrência numa rota FIXA com o id na query, em vez de `/checklists/[id]`.
 *
 * O id é gerado no aparelho (UUIDv7), então um checklist criado offline tem uma URL nova que
 * nenhum cache jamais viu — e o Next não renderiza uma rota dinâmica sem servidor. Com a rota
 * fixa, o HTML guardado de `/checklists/detalhe` serve para QUALQUER id (a tela é client-side e
 * lê o registro do IndexedDB); o Service Worker casa ignorando a query. As URLs antigas
 * (`/checklists/[id]`) continuam existindo, redirecionando para estas.
 */
export function checklistDetailHref(eventId: string, checklistId: string): string {
  return `/eventos/${encodeURIComponent(eventId)}/checklists/detalhe?id=${encodeURIComponent(checklistId)}`;
}

export function occurrenceDetailHref(eventId: string, occurrenceId: string): string {
  return `/eventos/${encodeURIComponent(eventId)}/ocorrencias/detalhe?id=${encodeURIComponent(occurrenceId)}`;
}

/** Telas que precisam estar guardadas para um evento "preparado" abrir por completo sem rede. */
export function eventOfflineRoutes(eventId: string): string[] {
  const base = `/eventos/${encodeURIComponent(eventId)}`;
  return [
    base,
    `${base}/tarefas`,
    `${base}/checklists`,
    `${base}/ocorrencias`,
    // Rotas fixas dos detalhes (sem a query: o cache casa ignorando-a).
    `${base}/checklists/detalhe`,
    `${base}/ocorrencias/detalhe`,
    "/configuracoes/sincronizacao",
  ];
}
