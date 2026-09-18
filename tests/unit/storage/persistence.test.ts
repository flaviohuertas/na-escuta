import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUOTA_WARNING_THRESHOLD,
  getStorageStatus,
  isNearQuotaLimit,
  requestPersistentStorage,
} from "@/lib/storage/persistence";

describe("storage/persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getStorageStatus reporta uso, quota e razão calculada", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ usage: 50_000_000, quota: 100_000_000 }),
        persisted: async () => true,
        persist: async () => true,
      },
    });

    const status = await getStorageStatus();
    expect(status.supported).toBe(true);
    expect(status.persisted).toBe(true);
    expect(status.usageBytes).toBe(50_000_000);
    expect(status.usageRatio).toBeCloseTo(0.5);
  });

  it("isNearQuotaLimit acusa quando a razão passa do limiar de aviso", () => {
    expect(isNearQuotaLimit({ supported: true, persisted: true, usageBytes: 1, quotaBytes: 1, usageRatio: QUOTA_WARNING_THRESHOLD + 0.01 })).toBe(true);
    expect(isNearQuotaLimit({ supported: true, persisted: true, usageBytes: 1, quotaBytes: 10, usageRatio: 0.1 })).toBe(false);
  });

  it("retorna supported=false quando a Storage API não existe (navegador sem suporte)", async () => {
    vi.stubGlobal("navigator", {});
    const status = await getStorageStatus();
    expect(status.supported).toBe(false);
    expect(status.usageRatio).toBeNull();
  });

  it("requestPersistentStorage retorna false silenciosamente quando não suportado", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
