import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_PAGES_CACHE_NAME, eventOfflineRoutes } from "@/lib/offline/routes";
import { clearEventRoutesCache } from "@/lib/offline/warm-routes";
import { installFakeCaches } from "../helpers/fake-caches";

const A = "01991b1a-0000-7000-8000-0000000000a0";
const B = "01991b1a-0000-7000-8000-0000000000b0";

describe("clearEventRoutesCache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tira as telas DESTE evento do cache — e só elas (nem as de outro evento, nem a de configurações, que é de todos)", async () => {
    // Regressão: o `caches` falso não tinha `delete(route)` e o `try/catch` engolia a falha — a
    // limpeza nunca foi de fato exercitada. O nome e os dados do evento vão no HTML guardado.
    const store = installFakeCaches({ [OFFLINE_PAGES_CACHE_NAME]: [...eventOfflineRoutes(A), ...eventOfflineRoutes(B)] });

    await clearEventRoutesCache(A);

    const left = store.get(OFFLINE_PAGES_CACHE_NAME)!;
    for (const route of eventOfflineRoutes(A).filter((r) => r.startsWith("/eventos/"))) expect(left.has(route), route).toBe(false);
    for (const route of eventOfflineRoutes(B)) expect(left.has(route), route).toBe(true);
    expect(left.has("/configuracoes/sincronizacao")).toBe(true);
  });

  it("sem Cache Storage no navegador não faz nada e não lança", async () => {
    await expect(clearEventRoutesCache(A)).resolves.toBeUndefined();
  });

  it("se o navegador recusar, não lança (é uma limpeza de melhor esforço)", async () => {
    vi.stubGlobal("caches", { open: async () => Promise.reject(new Error("negado")) });

    await expect(clearEventRoutesCache(A)).resolves.toBeUndefined();
  });
});
