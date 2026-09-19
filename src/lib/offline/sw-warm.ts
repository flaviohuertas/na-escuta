import { OFFLINE_PAGES_CACHE_NAME, isOfflineCacheablePath } from "./routes";

/**
 * Lado do Service Worker do "aquecimento" das telas do evento: busca cada rota como
 * documento HTML e a grava no cache de páginas. Roda DENTRO do SW (por isso funciona mesmo
 * quando ele está ativo mas ainda não controla a página que pediu). Sem `@/`-alias e sem
 * React: é empacotado junto do `service-worker.ts`.
 *
 * Só guarda o que a regra de cache do próprio SW guardaria (`isOfflineCacheablePath`) e só
 * respostas 200 sem redirecionamento — se a sessão expirou o servidor redireciona para
 * /login, e gravar isso no lugar da tela do evento a esconderia para sempre.
 */
export interface WarmInWorkerDeps {
  origin: string;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  openCache: (name: string) => Promise<Pick<Cache, "put">>;
}

export interface WarmInWorkerResult {
  cached: string[];
  failed: string[];
}

/** Um evento tem 5 telas; o teto evita que uma mensagem forjada mande o SW baixar centenas. */
const MAX_URLS = 20;

export async function warmRoutesInWorker(
  rawUrls: unknown,
  deps: WarmInWorkerDeps
): Promise<WarmInWorkerResult> {
  const urls = (Array.isArray(rawUrls) ? rawUrls : [])
    .filter((u): u is string => typeof u === "string")
    .slice(0, MAX_URLS);

  const cached: string[] = [];
  const failed: string[] = [];
  const cache = await deps.openCache(OFFLINE_PAGES_CACHE_NAME);

  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw, deps.origin);
    } catch {
      failed.push(raw);
      continue;
    }
    if (url.origin !== deps.origin || !isOfflineCacheablePath(url.pathname)) {
      failed.push(raw);
      continue;
    }
    try {
      const response = await deps.fetchImpl(url.href, {
        headers: { Accept: "text/html" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status !== 200 || response.redirected) {
        failed.push(raw);
        continue;
      }
      await cache.put(url.href, response);
      cached.push(raw);
    } catch {
      failed.push(raw);
    }
  }
  return { cached, failed };
}
