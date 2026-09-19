import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
// Import relativo (não `@/`): o SW é empacotado à parte e não passa pelo alias do tsconfig.
import {
  OFFLINE_PAGES_CACHE_NAME,
  WARM_ROUTES_MESSAGE,
  isOfflineCacheablePath,
} from "../lib/offline/routes";
import { warmRoutesInWorker } from "../lib/offline/sw-warm";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Documentos HTML das telas do evento (ver `lib/offline/routes.ts`), para que abrir,
 * recarregar ou navegar até elas funcione sem rede.
 *
 * Por que uma regra própria: a regra de HTML do `defaultCache` do Serwist casa pelo header
 * `Content-Type` da REQUISIÇÃO, que navegações nunca enviam — ela jamais dispara. Sem isto,
 * nenhum documento ficava guardado e o reload offline dava ERR_FAILED.
 *
 * - NetworkFirst com timeout: com rede boa, sempre HTML fresco; sem rede ou com rede ruim
 *   (campo), cai no guardado depois de 4s em vez de pendurar.
 * - Só guarda 200 sem redirecionamento: se a sessão expirou o servidor redireciona para
 *   /login, e guardar isso no lugar da tela do evento esconderia a tela para sempre.
 * - Sem `Vary`: o Next varia por headers de RSC que a navegação e a `fetch()` de aquecimento
 *   não mandam iguais.
 */
const offlinePagesRule: RuntimeCaching = {
  matcher: ({ request, url, sameOrigin }) =>
    sameOrigin &&
    request.headers.get("RSC") !== "1" &&
    isOfflineCacheablePath(url.pathname) &&
    (request.mode === "navigate" || (request.headers.get("Accept") ?? "").includes("text/html")),
  handler: new NetworkFirst({
    cacheName: OFFLINE_PAGES_CACHE_NAME,
    networkTimeoutSeconds: 4,
    matchOptions: { ignoreVary: true },
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response.status === 200 && !response.redirected ? response : null,
      },
      // 7 dias = padrão de Company.offlineAccessDays: guardado além do acesso offline não serve.
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
};

/**
 * Cacheia o app shell (JS, CSS, fontes) via precache do build (`__SW_MANIFEST`), os
 * documentos das telas do evento (regra acima) e o `defaultCache` do Serwist para o
 * resto. Os dados operacionais (tarefas/checklists/ocorrências) não passam por aqui,
 * vêm do IndexedDB.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Nossa regra vem ANTES: a primeira que casa vence.
  runtimeCaching: [offlinePagesRule, ...defaultCache],
});

serwist.addEventListeners();

/**
 * "Guarde estas telas": a página pede ao SW (em vez de fazer `fetch()` ela mesma) porque na
 * primeira carga o SW pode estar ativo sem ter assumido o controle da página — as requisições
 * dela então nem passam por ele. Aqui dentro a busca e a gravação sempre funcionam.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type !== WARM_ROUTES_MESSAGE) return;
  const replyPort = event.ports[0];
  event.waitUntil(
    warmRoutesInWorker(event.data.urls, {
      origin: self.location.origin,
      fetchImpl: (input, init) => fetch(input, init),
      openCache: (name) => caches.open(name),
    })
      .then((result) => replyPort?.postMessage(result))
      .catch(() => replyPort?.postMessage({ cached: [], failed: [] }))
  );
});
