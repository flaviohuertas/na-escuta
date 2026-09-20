import { z } from "zod";
import { getDb } from "@/lib/db/dexie/db";
import { getOrCreateDeviceId } from "./device-id";
import { getStoredOfflineSession, storeOfflineSession } from "./offline-session";

/**
 * `fresh`: já há um grant recente desta pessoa neste aparelho.
 * `stored`: pedimos um novo e o guardamos.
 * `unauthorized`: o servidor recusou (sem sessão, ou sem vínculo ativo).
 * `failed`: não foi possível (rede, servidor, grant que não conferiu).
 */
export type OfflineGrantOutcome = "fresh" | "stored" | "unauthorized" | "failed";

/** Renova o grant a cada dia: ele é a "identidade" do aparelho para o servidor saber se ainda vale. */
export const RENEW_GRANT_AFTER_MS = 24 * 60 * 60 * 1000;

const GrantResponseSchema = z.object({ jwt: z.string().min(1), serverTime: z.string().min(1) });

/**
 * Garante que o aparelho tem um grant offline guardado, de quem está logado agora.
 *
 * O servidor sempre soube emitir o grant, mas nenhuma tela o pedia. Ele é o que permite ao
 * aparelho, depois de perder a sessão, perguntar ao servidor se ainda vale (`checkDeviceStatus`).
 * Pede um novo quando não há nenhum, quando o guardado é de OUTRA pessoa (aparelho compartilhado)
 * ou de outro dispositivo, ou quando tem mais de um dia (o relógio do aparelho atrasado também
 * renova). Ao guardar um grant novo, o aviso de "aparelho revogado" sai: entrar de novo prova que o
 * acesso voltou.
 */
export async function ensureOfflineGrant(
  opts: { userId?: string; fetchImpl?: typeof fetch; now?: () => number } = {}
): Promise<OfflineGrantOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const deviceId = getOrCreateDeviceId();

  const stored = await getStoredOfflineSession();
  if (stored && stored.deviceId === deviceId && (opts.userId === undefined || stored.userId === opts.userId)) {
    const ageMs = now() - new Date(stored.issuedAt).getTime();
    if (ageMs >= 0 && ageMs < RENEW_GRANT_AFTER_MS) return "fresh";
  }

  try {
    const res = await fetchImpl("/api/auth/offline-grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return "unauthorized";
    if (!res.ok) return "failed";
    const parsed = GrantResponseSchema.safeParse(await res.json());
    if (!parsed.success) return "failed";

    await storeOfflineSession(parsed.data);
    await getDb().deviceState.delete("revocation");
    return "stored";
  } catch {
    return "failed";
  }
}
