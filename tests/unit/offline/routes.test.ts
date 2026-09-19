import { describe, expect, it } from "vitest";
import { eventOfflineRoutes, isOfflineCacheablePath } from "@/lib/offline/routes";

describe("offline/routes", () => {
  it("guarda só telas do evento e as configurações de sincronização", () => {
    expect(isOfflineCacheablePath("/eventos/abc")).toBe(true);
    expect(isOfflineCacheablePath("/eventos/abc/tarefas")).toBe(true);
    expect(isOfflineCacheablePath("/eventos/abc/checklists/xyz")).toBe(true);
    expect(isOfflineCacheablePath("/configuracoes/sincronizacao")).toBe(true);
  });

  it("nunca guarda telas que dependem do servidor, login ou API", () => {
    // Catálogo e painel leem o Postgres ao vivo: um retrato guardado enganaria.
    expect(isOfflineCacheablePath("/eventos")).toBe(false);
    expect(isOfflineCacheablePath("/painel")).toBe(false);
    expect(isOfflineCacheablePath("/conflitos")).toBe(false);
    expect(isOfflineCacheablePath("/login")).toBe(false);
    expect(isOfflineCacheablePath("/api/sync/pull")).toBe(false);
    expect(isOfflineCacheablePath("/")).toBe(false);
    // Prefixo parecido não conta.
    expect(isOfflineCacheablePath("/eventosx/1")).toBe(false);
  });

  it("lista as telas que um evento preparado precisa ter guardadas, todas dentro da regra acima", () => {
    const routes = eventOfflineRoutes("evt-1");
    expect(routes).toEqual([
      "/eventos/evt-1",
      "/eventos/evt-1/tarefas",
      "/eventos/evt-1/checklists",
      "/eventos/evt-1/ocorrencias",
      "/configuracoes/sincronizacao",
    ]);
    // Se a lista de aquecimento e a regra do Service Worker divergirem, o aquecimento
    // "funciona" mas o SW nunca guarda nada.
    for (const route of routes) expect(isOfflineCacheablePath(route)).toBe(true);
  });

  it("codifica o id na URL", () => {
    expect(eventOfflineRoutes("a b/c")[0]).toBe("/eventos/a%20b%2Fc");
  });
});
