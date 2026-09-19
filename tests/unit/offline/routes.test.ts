import { describe, expect, it } from "vitest";
import {
  OFFLINE_FALLBACK_URL,
  checklistDetailHref,
  eventOfflineRoutes,
  isOfflineCacheablePath,
  occurrenceDetailHref,
} from "@/lib/offline/routes";

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
      "/eventos/evt-1/checklists/detalhe",
      "/eventos/evt-1/ocorrencias/detalhe",
      "/configuracoes/sincronizacao",
    ]);
    // Se a lista de aquecimento e a regra do Service Worker divergirem, o aquecimento
    // "funciona" mas o SW nunca guarda nada.
    for (const route of routes) expect(isOfflineCacheablePath(route)).toBe(true);
  });

  it("codifica o id na URL", () => {
    expect(eventOfflineRoutes("a b/c")[0]).toBe("/eventos/a%20b%2Fc");
  });

  describe("detalhe numa rota fixa com o id na query", () => {
    it("monta as URLs com o id em ?id= (o id é gerado no aparelho, então não pode fazer parte do caminho)", () => {
      expect(checklistDetailHref("evt-1", "chk-9")).toBe("/eventos/evt-1/checklists/detalhe?id=chk-9");
      expect(occurrenceDetailHref("evt-1", "occ-9")).toBe("/eventos/evt-1/ocorrencias/detalhe?id=occ-9");
    });

    it("codifica ids com caracteres especiais", () => {
      expect(checklistDetailHref("a b", "x&y=1")).toBe("/eventos/a%20b/checklists/detalhe?id=x%26y%3D1");
    });

    it("o caminho (sem a query) é uma das telas aquecidas e cai na regra de cache do Service Worker", () => {
      // Se o caminho do detalhe não estivesse na lista de aquecimento, o checklist criado offline
      // continuaria sem HTML guardado; se saísse da regra do SW, nunca seria guardado.
      const routes = eventOfflineRoutes("evt-1");
      for (const href of [checklistDetailHref("evt-1", "c1"), occurrenceDetailHref("evt-1", "o1")]) {
        const path = href.split("?")[0]!;
        expect(routes).toContain(path);
        expect(isOfflineCacheablePath(path)).toBe(true);
      }
    });
  });

  it("a tela de fallback offline NÃO entra na regra de cache de páginas do usuário (ela é pré-cache público)", () => {
    expect(OFFLINE_FALLBACK_URL).toBe("/offline");
    expect(isOfflineCacheablePath(OFFLINE_FALLBACK_URL)).toBe(false);
  });
});
