import { describe, expect, it, vi } from "vitest";
import { OFFLINE_PAGES_CACHE_NAME, eventOfflineRoutes } from "@/lib/offline/routes";
import { warmRoutesInWorker, type WarmInWorkerDeps } from "@/lib/offline/sw-warm";

const ORIGIN = "http://localhost:3100";

function fakeResponse(init: { status?: number; redirected?: boolean } = {}): Response {
  return { status: init.status ?? 200, redirected: init.redirected ?? false } as Response;
}

function makeDeps(
  fetchImpl: WarmInWorkerDeps["fetchImpl"]
): WarmInWorkerDeps & { put: ReturnType<typeof vi.fn>; openedNames: string[] } {
  const put = vi.fn(async () => {});
  const openedNames: string[] = [];
  return {
    origin: ORIGIN,
    fetchImpl,
    openCache: async (name) => {
      openedNames.push(name);
      return { put };
    },
    put,
    openedNames,
  };
}

describe("offline/sw-warm (lado do Service Worker)", () => {
  const routes = eventOfflineRoutes("evt-1");

  it("busca cada rota como HTML com credenciais e grava a URL completa no cache de páginas", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse());
    const deps = makeDeps(fetchImpl);

    const result = await warmRoutesInWorker(routes, deps);

    expect(result).toEqual({ cached: routes, failed: [] });
    expect(deps.openedNames).toEqual([OFFLINE_PAGES_CACHE_NAME]);
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}${routes[0]}`, {
      headers: { Accept: "text/html" },
      credentials: "same-origin",
      cache: "no-store",
    });
    // A chave é a URL absoluta: é o que o cache de navegação (NetworkFirst) usa ao procurar.
    expect(deps.put).toHaveBeenCalledWith(`${ORIGIN}${routes[0]}`, expect.anything());
  });

  it("NÃO grava respostas com redirecionamento (sessão expirada → /login) nem erros", async () => {
    const responses: Record<string, Response> = {
      [`${ORIGIN}${routes[0]}`]: fakeResponse({ redirected: true }),
      [`${ORIGIN}${routes[1]}`]: fakeResponse({ status: 500 }),
      [`${ORIGIN}${routes[2]}`]: fakeResponse({ status: 302 }),
    };
    const deps = makeDeps(async (url) => responses[url] ?? fakeResponse());

    const result = await warmRoutesInWorker(routes, deps);

    expect(result.failed).toEqual(routes.slice(0, 3));
    expect(result.cached).toEqual(routes.slice(3));
    expect(deps.put).toHaveBeenCalledTimes(routes.length - 3);
  });

  it("uma rota que falha na rede não impede as outras", async () => {
    const deps = makeDeps(async (url) => {
      if (url.endsWith("/tarefas")) throw new TypeError("Failed to fetch");
      return fakeResponse();
    });

    const result = await warmRoutesInWorker(routes, deps);

    expect(result.failed).toEqual([routes[1]]);
    expect(result.cached).toEqual(routes.filter((r) => r !== routes[1]));
  });

  it("recusa URLs fora da regra de cache ou de outra origem, sem nem buscá-las", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse());
    const deps = makeDeps(fetchImpl);

    const result = await warmRoutesInWorker(
      ["/painel", "/api/sync/pull", "/eventos", "https://evil.example/eventos/x", "http://[quebrada"],
      deps
    );

    expect(result.cached).toEqual([]);
    expect(result.failed).toHaveLength(5);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignora lixo na mensagem e limita a quantidade de URLs", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse());
    const deps = makeDeps(fetchImpl);

    expect(await warmRoutesInWorker(undefined, deps)).toEqual({ cached: [], failed: [] });
    expect(await warmRoutesInWorker("/eventos/x", deps)).toEqual({ cached: [], failed: [] });
    expect(await warmRoutesInWorker([1, null, {}], deps)).toEqual({ cached: [], failed: [] });

    const many = Array.from({ length: 200 }, (_, i) => `/eventos/e${i}`);
    const result = await warmRoutesInWorker(many, deps);
    expect(result.cached).toHaveLength(20);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });
});
