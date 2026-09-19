import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_PAGES_CACHE_NAME, WARM_ROUTES_MESSAGE, eventOfflineRoutes } from "@/lib/offline/routes";
import {
  areEventRoutesCached,
  clearUserScopedCaches,
  warmEventRoutes,
} from "@/lib/offline/warm-routes";
import { installFakeCaches, stubNoServiceWorker, stubServiceWorker } from "../helpers/fake-caches";

const eventId = "evt-1";
const routes = eventOfflineRoutes(eventId);

/** O que o SW "grava" ao receber o pedido: as rotas caem no cache de páginas. */
function storeRoutesIn(store: Map<string, Set<string>>) {
  return (urls: string[]) => {
    if (!store.has(OFFLINE_PAGES_CACHE_NAME)) store.set(OFFLINE_PAGES_CACHE_NAME, new Set());
    for (const url of urls) store.get(OFFLINE_PAGES_CACHE_NAME)!.add(url);
  };
}

const fast = { verifyTimeoutMs: 80, replyTimeoutMs: 200 };

describe("offline/warm-routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("warmEventRoutes", () => {
    it("pede ao Service Worker as telas do evento e só conta como guardada a que aparece no Cache Storage", async () => {
      const store = installFakeCaches();
      const worker = stubServiceWorker({ onWarm: storeRoutesIn(store) });

      const result = await warmEventRoutes(eventId, { ...fast, verifyTimeoutMs: 500 });

      expect(result).toEqual({ serviceWorkerActive: true, cached: routes, failed: [] });
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      const [message, transfer] = worker.postMessage.mock.calls[0]!;
      expect(message).toEqual({ type: WARM_ROUTES_MESSAGE, urls: routes });
      expect(transfer).toHaveLength(1); // porta para a resposta
    });

    it("funciona com o SW ATIVO mas SEM controlar a página (regressão medida: controller nulo)", async () => {
      // `stubServiceWorker` deixa `controller: null` sempre. Antes, a página fazia `fetch()` e
      // dependia de o SW interceptar — sem controle, nada era guardado e o selo nunca acendia.
      const store = installFakeCaches();
      stubServiceWorker({ active: true, onWarm: storeRoutesIn(store) });

      const result = await warmEventRoutes(eventId, { ...fast, verifyTimeoutMs: 500 });

      expect(result.failed).toEqual([]);
      expect(result.cached).toEqual(routes);
    });

    it("a gravação no cache pode chegar depois da resposta do SW: a verificação espera", async () => {
      const store = installFakeCaches();
      stubServiceWorker({ onWarm: storeRoutesIn(store), writeDelayMs: 60 });

      const result = await warmEventRoutes(eventId, { ...fast, verifyTimeoutMs: 1000 });

      expect(result.failed).toEqual([]);
    });

    it("SW que responde mas RECUSA guardar (ex.: sessão expirada) é falha, não sucesso", async () => {
      installFakeCaches();
      stubServiceWorker({ onWarm: () => {} });

      const result = await warmEventRoutes(eventId, fast);

      expect(result.serviceWorkerActive).toBe(true);
      expect(result.cached).toEqual([]);
      expect(result.failed).toEqual(routes);
    });

    it("SW que não responde no prazo: verifica o cache mesmo assim e reporta o que faltou", async () => {
      const store = installFakeCaches();
      // Guardou só as duas primeiras antes de travar.
      stubServiceWorker({ reply: false, onWarm: () => storeRoutesIn(store)(routes.slice(0, 2)) });

      const result = await warmEventRoutes(eventId, fast);

      expect(result.cached).toEqual(routes.slice(0, 2));
      expect(result.failed).toEqual(routes.slice(2));
    });

    it("sem Service Worker no navegador: falha na hora, sem esperar", async () => {
      installFakeCaches();
      stubNoServiceWorker();

      const result = await warmEventRoutes(eventId, { serviceWorkerTimeoutMs: 5000 });

      expect(result).toEqual({ serviceWorkerActive: false, cached: [], failed: routes });
    });

    it("Service Worker não registrado (ex.: `next dev`): falha na hora — `ready` nunca resolveria", async () => {
      installFakeCaches();
      const worker = stubServiceWorker({ registered: false, neverActive: true });

      const started = Date.now();
      const result = await warmEventRoutes(eventId, { serviceWorkerTimeoutMs: 5000 });

      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ serviceWorkerActive: false, cached: [], failed: routes });
      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it("Service Worker ainda instalando (aparelho recém-aberto): espera ficar ativo e só então pede", async () => {
      const store = installFakeCaches();
      stubServiceWorker({ active: false, installingMs: 60, onWarm: storeRoutesIn(store) });

      const result = await warmEventRoutes(eventId, { ...fast, verifyTimeoutMs: 500, serviceWorkerTimeoutMs: 2000 });

      expect(result).toEqual({ serviceWorkerActive: true, cached: routes, failed: [] });
    });

    it("Service Worker que nunca fica ativo: desiste no prazo e não pede nada", async () => {
      installFakeCaches();
      const worker = stubServiceWorker({ active: false, neverActive: true });

      const result = await warmEventRoutes(eventId, { serviceWorkerTimeoutMs: 100 });

      expect(result).toEqual({ serviceWorkerActive: false, cached: [], failed: routes });
      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it("sem Cache Storage no navegador, tudo falha sem lançar erro", async () => {
      vi.stubGlobal("caches", undefined);
      const worker = stubServiceWorker();

      const result = await warmEventRoutes(eventId);

      expect(result).toEqual({ serviceWorkerActive: false, cached: [], failed: routes });
      expect(worker.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("areEventRoutesCached", () => {
    it("é verdadeiro só quando TODAS as telas do evento estão guardadas", async () => {
      const store = installFakeCaches({ [OFFLINE_PAGES_CACHE_NAME]: routes });
      expect(await areEventRoutesCached(eventId)).toBe(true);

      store.get(OFFLINE_PAGES_CACHE_NAME)!.delete(routes[2]!);
      expect(await areEventRoutesCached(eventId)).toBe(false);
    });

    it("é falso para outro evento e quando não há Cache Storage", async () => {
      installFakeCaches({ [OFFLINE_PAGES_CACHE_NAME]: routes });
      expect(await areEventRoutesCached("outro-evento")).toBe(false);

      vi.stubGlobal("caches", undefined);
      expect(await areEventRoutesCached(eventId)).toBe(false);
    });
  });

  describe("clearUserScopedCaches", () => {
    it("apaga o que é do usuário (HTML, RSC, API) e preserva só o pré-cache do build", async () => {
      const store = installFakeCaches({
        [OFFLINE_PAGES_CACHE_NAME]: routes,
        "pages-rsc": ["/eventos/x?_rsc=1"],
        "pages-rsc-prefetch": ["/painel?_rsc=1"],
        apis: ["/api/foo"],
        "serwist-precache-v2-http://localhost:3100/": ["/_next/static/chunks/a.js"],
      });

      await clearUserScopedCaches();

      expect([...store.keys()]).toEqual(["serwist-precache-v2-http://localhost:3100/"]);
    });

    it("não lança quando o Cache Storage não existe", async () => {
      vi.stubGlobal("caches", undefined);
      await expect(clearUserScopedCaches()).resolves.toBeUndefined();
    });
  });
});
