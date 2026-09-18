import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectivityMonitor } from "@/lib/sync/connectivity";

describe("ConnectivityMonitor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fica online quando o ping ao /api/health responde ok", async () => {
    const monitor = new ConnectivityMonitor({ healthUrl: "/api/health" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);

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

    expect(result).toBe(false);
    expect(monitor.getState().status).toBe("offline");
  });

  it("fica offline quando o servidor responde com erro (ex.: 500)", async () => {
    const monitor = new ConnectivityMonitor();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response);

    const result = await monitor.checkNow(fetchMock);

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

    await monitor.checkNow(vi.fn().mockResolvedValue({ ok: true } as Response));
    await monitor.checkNow(vi.fn().mockResolvedValue({ ok: false } as Response));

    expect(states).toEqual(["online", "offline"]);
  });
});
