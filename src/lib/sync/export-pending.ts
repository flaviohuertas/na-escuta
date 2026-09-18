import type { AppDatabase } from "@/lib/db/dexie/schema";

export interface ExportedPendingData {
  exportedAt: string;
  deviceId: string;
  outbox: unknown[];
}

export interface EncryptedExport {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

const PBKDF2_ITERATIONS = 210_000;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

/**
 * Exporta as alterações pendentes (outbox) como um arquivo cifrado (AES-GCM
 * 256 bits, chave derivada da senha via PBKDF2/SHA-256, 210k iterações —
 * recomendação OWASP 2023) antes de um logout com limpeza do dispositivo.
 * Sem a senha, o conteúdo é inutilizável — não é "proteção decorativa".
 */
export async function exportPendingChangesEncrypted(
  db: AppDatabase,
  passphrase: string
): Promise<EncryptedExport> {
  const outbox = await db.outbox.toArray();
  const payload: ExportedPendingData = {
    exportedAt: new Date().toISOString(),
    deviceId: outbox[0]?.deviceId ?? "desconhecido",
    outbox,
  };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);

  return { version: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptPendingExport(
  exported: EncryptedExport,
  passphrase: string
): Promise<ExportedPendingData> {
  const salt = fromBase64(exported.salt);
  const iv = fromBase64(exported.iv);
  const key = await deriveKey(passphrase, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    fromBase64(exported.ciphertext) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
