import {
  OFFLINE_PAGES_CACHE_NAME,
  PRECACHE_NAME_PREFIX,
  WARM_ROUTES_MESSAGE,
  eventOfflineRoutes,
} from "./routes";

export interface WarmRoutesResult {
  /** Existe um Service Worker ativo que pôde receber o pedido de guardar as telas? */
  serviceWorkerActive: boolean;
  /** Rotas comprovadamente presentes no Cache Storage depois do aquecimento. */
  cached: string[];
  failed: string[];
}

const VERIFY_TIMEOUT_MS = 3000;
const VERIFY_POLL_MS = 50;
/** Instalar o SW baixa todo o pré-cache do build; em rede de campo isso leva segundos. */
const SERVICE_WORKER_TIMEOUT_MS = 15_000;
/** Tempo que o SW tem para buscar e gravar TODAS as rotas (várias requisições ao servidor). */
const WARM_REPLY_TIMEOUT_MS = 20_000;

function cacheStorageAvailable(): boolean {
  return typeof caches !== "undefined";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Devolve o Service Worker ATIVO, esperando ele terminar de instalar se preciso. Não exige
 * que ele controle esta página: logo após o primeiro acesso ele pode estar ativo sem ter
 * assumido o controle (o documento nasceu depois do `clients.claim()`), e mesmo assim consegue
 * receber mensagens e gravar no Cache Storage. Sem registro nenhum (ex.: `next dev`, onde o SW
 * é desligado) devolve `null` na hora — `serviceWorker.ready` nunca resolveria.
 */
async function getActiveServiceWorker(timeoutMs: number): Promise<ServiceWorker | null> {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw) return null;
  try {
    const registration = await sw.getRegistration?.();
    if (!registration) return null;
    if (registration.active) return registration.active;
    const ready = await Promise.race([sw.ready, sleep(timeoutMs).then(() => null)]);
    return ready?.active ?? null;
  } catch {
    return null;
  }
}

/** Pede ao SW que busque e guarde as rotas; resolve quando ele responde (ou no prazo). */
function askServiceWorkerToWarm(worker: ServiceWorker, routes: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = () => {
      clearTimeout(timer);
      channel.port1.close();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    channel.port1.onmessage = finish;
    worker.postMessage({ type: WARM_ROUTES_MESSAGE, urls: routes }, [channel.port2]);
  });
}

async function isRouteCached(route: string): Promise<boolean> {
  const cache = await caches.open(OFFLINE_PAGES_CACHE_NAME);
  // Vary do Next inclui headers de RSC que a navegação real não manda iguais.
  return Boolean(await cache.match(route, { ignoreVary: true }));
}

async function waitUntilCached(route: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isRouteCached(route)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(VERIFY_POLL_MS);
  }
}

/**
 * Pede ao Service Worker que busque cada tela do evento como documento HTML e a guarde,
 * e depois CONFIRMA no Cache Storage que ela realmente entrou — "o SW respondeu" não prova
 * nada se ele recusou guardar (ex.: a sessão expirou e o servidor redirecionou para /login).
 */
export async function warmEventRoutes(
  eventId: string,
  opts: { verifyTimeoutMs?: number; serviceWorkerTimeoutMs?: number; replyTimeoutMs?: number } = {}
): Promise<WarmRoutesResult> {
  const verifyTimeoutMs = opts.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;
  const routes = eventOfflineRoutes(eventId);

  if (!cacheStorageAvailable()) {
    return { serviceWorkerActive: false, cached: [], failed: routes };
  }

  const worker = await getActiveServiceWorker(opts.serviceWorkerTimeoutMs ?? SERVICE_WORKER_TIMEOUT_MS);
  // Sem SW ativo não há quem guarde: nem tenta.
  if (!worker) return { serviceWorkerActive: false, cached: [], failed: routes };

  try {
    await askServiceWorkerToWarm(worker, routes, opts.replyTimeoutMs ?? WARM_REPLY_TIMEOUT_MS);
  } catch {
    return { serviceWorkerActive: true, cached: [], failed: routes };
  }

  const cached: string[] = [];
  const failed: string[] = [];
  for (const route of routes) {
    try {
      if (await waitUntilCached(route, verifyTimeoutMs)) cached.push(route);
      else failed.push(route);
    } catch {
      failed.push(route);
    }
  }
  return { serviceWorkerActive: true, cached, failed };
}

/** Todas as telas do evento estão no Cache Storage agora? (verdade do navegador, não um flag nosso.) */
export async function areEventRoutesCached(eventId: string): Promise<boolean> {
  if (!cacheStorageAvailable()) return false;
  try {
    for (const route of eventOfflineRoutes(eventId)) {
      if (!(await isRouteCached(route))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Tira do cache do navegador as telas DE UM evento (o HTML carrega o nome e dados dele). Usado
 * quando o acesso ao evento foi retirado. Não toca `/configuracoes/sincronizacao`, que é de todos
 * os eventos, nem as telas dos outros. Best-effort: nunca lança.
 */
export async function clearEventRoutesCache(eventId: string): Promise<void> {
  if (!cacheStorageAvailable()) return;
  try {
    const cache = await caches.open(OFFLINE_PAGES_CACHE_NAME);
    const routes = eventOfflineRoutes(eventId).filter((route) => route.startsWith("/eventos/"));
    await Promise.all(routes.map((route) => cache.delete(route, { ignoreSearch: true, ignoreVary: true })));
  } catch {
    // Sem permissão/API indisponível: nada a fazer.
  }
}

/**
 * Apaga tudo que o navegador guardou POR CAUSA do usuário logado (HTML e payloads RSC
 * carregam nome, dados do evento etc.). Mantém só o pré-cache do build, que contém
 * apenas código público. Chamado no logout — best-effort, nunca bloqueia a saída.
 */
export async function clearUserScopedCaches(): Promise<void> {
  if (!cacheStorageAvailable()) return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => !name.startsWith(PRECACHE_NAME_PREFIX)).map((name) => caches.delete(name))
    );
  } catch {
    // Sem permissão/API indisponível: nada a fazer.
  }
}
