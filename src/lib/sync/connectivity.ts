export type ConnectivityStatus = "online" | "offline";

export interface ConnectivityState {
  status: ConnectivityStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

type Listener = (state: ConnectivityState) => void;

const DEFAULT_RETRY_BASE_MS = 2000;
const DEFAULT_RETRY_MAX_MS = 30_000;

/**
 * Não confiamos só em `navigator.onLine` (ele só reflete a interface de
 * rede do SO, não se o servidor está realmente alcançável — uma rede Wi-Fi
 * "conectada" mas sem internet real ainda reporta `true`). "Online efetivo"
 * aqui significa: `navigator.onLine !== false` E um ping recente a
 * `/api/health` respondeu com sucesso.
 *
 * Quando o ping falha mas o navegador diz que há rede, tenta de novo com
 * backoff (2s, 4s, 8s… até 30s). Sem isso um único ping malsucedido logo depois
 * do evento `online` (a rede ainda subindo, DNS não pronto) deixava o app preso
 * em "Offline" — e como "Sincronizar agora" fica desabilitado offline, a pessoa
 * nem conseguia pedir um novo teste. Quando o navegador diz que está offline
 * não há o que tentar: o próprio evento `online` dispara a próxima checagem.
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
  private retryBaseMs: number;
  private retryMaxMs: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private inFlight: Promise<boolean> | null = null;

  constructor(opts?: { healthUrl?: string; timeoutMs?: number; retryBaseMs?: number; retryMaxMs?: number }) {
    this.healthUrl = opts?.healthUrl ?? "/api/health";
    this.timeoutMs = opts?.timeoutMs ?? 5000;
    this.retryBaseMs = opts?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = opts?.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
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

  /** Cancela a próxima retentativa agendada e zera o backoff. */
  stopRetrying(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  private scheduleRetry(fetchImpl: typeof fetch): void {
    if (this.retryTimer) return;
    const delay = Math.min(this.retryBaseMs * 2 ** this.retryAttempt, this.retryMaxMs);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.checkNow(fetchImpl);
    }, delay);
  }

  /**
   * Ping ativo contra o servidor. Retorna se está efetivamente online. Chamadas simultâneas
   * (ex.: retentativa e evento `online` ao mesmo tempo) compartilham a mesma verificação.
   */
  checkNow(fetchImpl: typeof fetch = fetch): Promise<boolean> {
    if (!this.inFlight) {
      this.inFlight = this.runCheck(fetchImpl).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async runCheck(fetchImpl: typeof fetch): Promise<boolean> {
    const checkedAt = new Date().toISOString();
    // Estamos checando agora: uma retentativa já agendada seria redundante.
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Sem rede segundo o navegador: o evento `online` dispara a próxima checagem.
      this.retryAttempt = 0;
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
      if (ok) this.retryAttempt = 0;
      else this.scheduleRetry(fetchImpl);
      return ok;
    } catch {
      this.setState({ status: "offline", lastCheckedAt: checkedAt });
      this.scheduleRetry(fetchImpl);
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
      this.stopRetrying();
      this.setState({ status: "offline", lastCheckedAt: new Date().toISOString() });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      this.stopRetrying();
    };
  }
}

export const connectivityMonitor = new ConnectivityMonitor();
