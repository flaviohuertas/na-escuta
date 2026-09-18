import { generateEntityId } from "@/lib/sync/ids";

const STORAGE_KEY = "na-escuta:device-id";

/**
 * Cada dispositivo tem um id estável gerado no cliente na primeira vez que o
 * app roda (localStorage, não Dexie — precisa existir antes/independente do
 * IndexedDB). É esse id que identifica o dispositivo nos grants offline e nas
 * operações da outbox.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error("getOrCreateDeviceId só pode ser chamado no browser.");
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = generateEntityId();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}
