import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectivityMonitor } from "@/lib/sync/connectivity";

const ok = { ok: true } as Response;
const notOk = { ok: false } as Response;

describe("ConnectivityMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fica online quando o ping ao /api/health responde ok", async () => {
    const monitor = new ConnectivityMonitor({ healthUrl: "/api/health" });
    const fetchMock = vi.fn().mockResolvedValue(ok);

    const result = await monitor.checkNow(fetchMock);

    expect(result).toBe(true);
    expect(monitor.getState().status).toBe("online");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("fica offline quando o fetch falha (sem rede)", async () => {
    const monitor = new ConnectivityMonitor();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await monitor.checkNow(fetchMock);
    monitor.stopRetrying();

    expect(result).toBe(false);
    expect(monitor.getState().status).toBe("offline");
  });

  it("fica offline quando o servidor responde com erro (ex.: 500)", async () => {
    const monitor = new ConnectivityMonitor();
    const fetchMock = vi.fn().mockResolvedValue(notOk);

    const result = await monitor.checkNow(fetchMock);
    monitor.stopRetrying();

    expect(result).toBe(false);
  });

  it("não faz fetch quando navigator.onLine já é false (economiza round-trip)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const monitor = new ConnectivityMonitor();
    const fetchMock = vi.fn();

    const result = await monitor.checkNow(fetchMock);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifica listeners inscritos a cada mudança de estado", async () => {
    const monitor = new ConnectivityMonitor();
    const states: string[] = [];
    monitor.subscribe((s) => states.push(s.status));

    await monitor.checkNow(vi.fn().mockResolvedValue(ok));
    await monitor.checkNow(vi.fn().mockResolvedValue(notOk));
    monitor.stopRetrying();

    expect(states).toEqual(["online", "offline"]);
  });

  describe("retentativa quando o ping falha mas o navegador diz que há rede", () => {
    it("tenta de novo com backoff e volta a 'online' sozinho — sem exigir recarregar a página", async () => {
      // Regressão medida no E2E: o ping logo após o evento `online` falhava uma vez (rede ainda
      // subindo) e o app ficava em "Offline" para sempre, com "Sincronizar agora" desabilitado.
      vi.useFakeTimers();
      const monitor = new ConnectivityMonitor({ retryBaseMs: 1000, retryMaxMs: 8000 });
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(notOk)
        .mockResolvedValue(ok);

      expect(await monitor.checkNow(fetchMock)).toBe(false);
      expect(monitor.getState().status).toBe("offline");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1); // ainda não
      await vi.advanceTimersByTimeAsync(1); // 1ª retentativa após 1s → falha (500)
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(monitor.getState().status).toBe("offline");

      await vi.advanceTimersByTimeAsync(2000); // 2ª retentativa após 2s → ok
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(monitor.getState().status).toBe("online");

      // Voltou: para de sondar.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("o intervalo dobra até um teto e não cresce além dele", async () => {
      vi.useFakeTimers();
      const monitor = new ConnectivityMonitor({ retryBaseMs: 1000, retryMaxMs: 4000 });
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await monitor.checkNow(fetchMock); // t=0
      await vi.advanceTimersByTimeAsync(1000); // t=1000  (espera 1s)
      await vi.advanceTimersByTimeAsync(2000); // t=3000  (espera 2s)
      await vi.advanceTimersByTimeAsync(4000); // t=7000  (espera 4s = teto)
      expect(fetchMock).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(3999);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1); // teto: 4s de novo, não 8s
      expect(fetchMock).toHaveBeenCalledTimes(5);

      monitor.stopRetrying();
    });

    it("não insiste enquanto o navegador diz que está offline (o evento `online` é quem avisa)", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("navigator", { onLine: false });
      const monitor = new ConnectivityMonitor({ retryBaseMs: 1000 });
      const fetchMock = vi.fn();

      await monitor.checkNow(fetchMock);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uma checagem manual/evento online cancela a retentativa agendada em vez de duplicá-la", async () => {
      vi.useFakeTimers();
      const monitor = new ConnectivityMonitor({ retryBaseMs: 1000 });
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("x")).mockResolvedValue(ok);

      await monitor.checkNow(fetchMock); // falha → agenda retentativa em 1s
      await monitor.checkNow(fetchMock); // checagem imediata → ok
      expect(monitor.getState().status).toBe("online");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(2); // a retentativa agendada não rodou
    });

    it("chamadas simultâneas compartilham uma única verificação", async () => {
      const monitor = new ConnectivityMonitor();
      let resolveFetch: (r: Response) => void = () => {};
      const fetchMock = vi.fn(
        () => new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
      );

      const first = monitor.checkNow(fetchMock as unknown as typeof fetch);
      const second = monitor.checkNow(fetchMock as unknown as typeof fetch);
      resolveFetch(ok);

      expect(await first).toBe(true);
      expect(await second).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("o evento `offline` do navegador cancela as retentativas; sair do app (cleanup) também", async () => {
      vi.useFakeTimers();
      const monitor = new ConnectivityMonitor({ retryBaseMs: 1000 });
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("x"));
      const detach = monitor.attachBrowserListeners();

      await monitor.checkNow(fetchMock);
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await monitor.checkNow(fetchMock); // falha de novo → agenda retentativa
      detach();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
