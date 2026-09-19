import { vi } from "vitest";

/**
 * CacheStorage mínimo em memória (jsdom não tem `caches`). Só implementa o que o app usa:
 * `keys`, `delete`, `open().match()`. Cada cache é um conjunto de URLs (rota → presente).
 * Devolve o `store` para o teste inspecionar/alterar o que "o Service Worker guardou".
 * Lembre de `vi.unstubAllGlobals()` no afterEach.
 */
export function installFakeCaches(initial: Record<string, string[]> = {}): Map<string, Set<string>> {
  const store = new Map<string, Set<string>>(
    Object.entries(initial).map(([name, urls]) => [name, new Set(urls)])
  );

  vi.stubGlobal("caches", {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Set());
      const urls = store.get(name)!;
      return {
        match: async (route: string) => (urls.has(route) ? ({} as Response) : undefined),
      };
    },
  });

  return store;
}

export interface FakeServiceWorkerOptions {
  /** `getRegistration()` devolve um registro? (false = SW desligado/inexistente, como em `next dev`) */
  registered?: boolean;
  /** Já há um worker ativo? Se não, ele fica ativo depois de `installingMs` (o `ready` resolve). */
  active?: boolean;
  installingMs?: number;
  /** O worker nunca chega a ficar ativo (o `ready` nunca resolve). */
  neverActive?: boolean;
  /** Simula o que o SW grava no cache ao receber o pedido; roda `writeDelayMs` depois da mensagem. */
  onWarm?: (urls: string[]) => void;
  writeDelayMs?: number;
  /** O SW responde pela porta da mensagem? (padrão: sim) */
  reply?: boolean;
  replyDelayMs?: number;
}

export interface FakeServiceWorker {
  postMessage: ReturnType<typeof vi.fn>;
}

/**
 * Service Worker falso em `navigator.serviceWorker`. Note que `controller` fica SEMPRE nulo
 * de propósito: o aquecimento não pode depender de o SW controlar a página (foi o defeito real
 * medido — SW ativo, controller nulo, requisições da página não passavam por ele).
 */
export function stubServiceWorker(opts: FakeServiceWorkerOptions = {}): FakeServiceWorker {
  const { registered = true, active = true, installingMs = 30, neverActive = false } = opts;
  const { writeDelayMs = 0, reply = true, replyDelayMs = 0 } = opts;

  const worker: FakeServiceWorker = {
    postMessage: vi.fn((message: { urls: string[] }, transfer?: MessagePort[]) => {
      const port = transfer?.[0];
      setTimeout(() => opts.onWarm?.(message.urls), writeDelayMs);
      if (reply) {
        setTimeout(() => port?.postMessage({ cached: message.urls, failed: [] }), replyDelayMs);
      }
    }),
  };

  const registration: { active: FakeServiceWorker | null } = { active: active ? worker : null };
  const ready = new Promise<typeof registration>((resolve) => {
    if (neverActive) return;
    if (active) resolve(registration);
    else {
      setTimeout(() => {
        registration.active = worker;
        resolve(registration);
      }, installingMs);
    }
  });

  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: null,
      getRegistration: async () => (registered ? registration : undefined),
      ready,
    },
  });
  return worker;
}

/** Navegador sem Service Worker (Safari antigo, contexto não seguro etc.). */
export function stubNoServiceWorker(): void {
  vi.stubGlobal("navigator", {});
}
