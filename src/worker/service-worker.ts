import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Cacheia o app shell (rotas, JS, CSS, fontes) via precache do build
 * (`__SW_MANIFEST`) + `defaultCache` do Serwist para runtime caching
 * (stale-while-revalidate para navegação/assets). É isso que permite abrir e
 * recarregar as telas já visitadas sem conexão — os dados operacionais em si
 * (tarefas/checklists/ocorrências) não passam por aqui, vêm do IndexedDB.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
