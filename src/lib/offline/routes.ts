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

export function isOfflineCacheablePath(pathname: string): boolean {
  return pathname.startsWith("/eventos/") || pathname === "/configuracoes/sincronizacao";
}

/** Telas que precisam estar guardadas para um evento "preparado" abrir por completo sem rede. */
export function eventOfflineRoutes(eventId: string): string[] {
  const base = `/eventos/${encodeURIComponent(eventId)}`;
  return [base, `${base}/tarefas`, `${base}/checklists`, `${base}/ocorrencias`, "/configuracoes/sincronizacao"];
}
