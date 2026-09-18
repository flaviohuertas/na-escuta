export type ConnectivityStatus = "online" | "offline";

export interface ConnectivityState {
  status: ConnectivityStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

type Listener = (state: ConnectivityState) => void;

/**
 * Não confiamos só em `navigator.onLine` (ele só reflete a interface de
 * rede do SO, não se o servidor está realmente alcançável — uma rede Wi-Fi
 * "conectada" mas sem internet real ainda reporta `true`). "Online efetivo"
 * aqui significa: `navigator.onLine !== false` E um ping recente a
 * `/api/health` respondeu com sucesso.
 */
export class ConnectivityMonitor {
  private state: ConnectivityState = {
    status: "offline",
    lastCheckedAt: null,
    lastSuccessAt: null,
  };
  private listeners = new Set<Listener>();
  private healthUrl: string;
  private timeoutMs: number;

  constructor(opts?: { healthUrl?: string; timeoutMs?: number }) {
    this.healthUrl = opts?.healthUrl ?? "/api/health";
    this.timeoutMs = opts?.timeoutMs ?? 5000;
  }

  getState(): ConnectivityState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<ConnectivityState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Ping ativo contra o servidor. Retorna se está efetivamente online. */
  async checkNow(fetchImpl: typeof fetch = fetch): Promise<boolean> {
    const checkedAt = new Date().toISOString();

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setState({ status: "offline", lastCheckedAt: checkedAt });
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetchImpl(this.healthUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const ok = res.ok;
      this.setState({
        status: ok ? "online" : "offline",
        lastCheckedAt: checkedAt,
        lastSuccessAt: ok ? checkedAt : this.state.lastSuccessAt,
      });
      return ok;
    } catch {
      this.setState({ status: "offline", lastCheckedAt: checkedAt });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Liga os listeners de rede do browser. Retorna função de limpeza. */
  attachBrowserListeners(): () => void {
    if (typeof window === "undefined") return () => {};
    const onOnline = () => {
      void this.checkNow();
    };
    const onOffline = () => {
      this.setState({ status: "offline", lastCheckedAt: new Date().toISOString() });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }
}

export const connectivityMonitor = new ConnectivityMonitor();
