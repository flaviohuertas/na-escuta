export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  usageRatio: number | null;
}

export const QUOTA_WARNING_THRESHOLD = 0.8;

/** Pede ao navegador para não descartar o armazenamento sob pressão — nem sempre é concedido (ex.: sem engajamento suficiente do usuário no site). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { supported: false, persisted: false, usageBytes: null, quotaBytes: null, usageRatio: null };
  }

  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
    navigator.storage.estimate(),
  ]);

  const usageBytes = estimate.usage ?? null;
  const quotaBytes = estimate.quota ?? null;
  const usageRatio = usageBytes != null && quotaBytes ? usageBytes / quotaBytes : null;

  return { supported: true, persisted, usageBytes, quotaBytes, usageRatio };
}

export function isNearQuotaLimit(status: StorageStatus): boolean {
  return status.usageRatio != null && status.usageRatio >= QUOTA_WARNING_THRESHOLD;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
