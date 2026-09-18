import { importJWK, jwtVerify } from "jose";
import { z } from "zod";
import { getDb } from "@/lib/db/dexie/db";
import type { OfflineSession } from "@/lib/db/dexie/schema";

export const OfflineGrantPayloadSchema = z.object({
  sub: z.string().uuid(),
  companyId: z.string().uuid(),
  deviceId: z.string().min(1),
  companyRole: z.string(),
  eventAccess: z.array(z.object({ eventId: z.string().uuid(), role: z.string() })),
});
export type OfflineGrantPayload = z.infer<typeof OfflineGrantPayloadSchema>;

function getPublicKeyJwk(): Record<string, unknown> {
  const raw = process.env.NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK não configurado — rode `npm run keys:generate`."
    );
  }
  return JSON.parse(raw);
}

export interface VerifiedOfflineGrant {
  payload: OfflineGrantPayload;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Verifica a assinatura EdDSA (Ed25519) do grant offline. Funciona sem rede:
 * a chave pública vem embutida no bundle do cliente (não é segredo). Se a
 * assinatura ou as claims forem inválidas, lança — nunca retorna "meio
 * válido".
 */
export async function verifyOfflineGrantJwt(jwt: string): Promise<VerifiedOfflineGrant> {
  const key = await importJWK(getPublicKeyJwk(), "EdDSA");
  const { payload } = await jwtVerify(jwt, key);
  const parsed = OfflineGrantPayloadSchema.parse(payload);

  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    throw new Error("Grant offline sem iat/exp — token malformado.");
  }

  return {
    payload: parsed,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

/**
 * Persiste a sessão offline localmente, ancorando o relógio: guardamos o
 * horário do servidor no momento em que o grant foi obtido e o
 * `performance.now()` local correspondente. A validade é sempre recalculada
 * como `lastVerifiedServerTime + (performance.now() - monotonicAnchorMs)` —
 * nunca `Date.now()` puro — para que adiantar/atrasar o relógio do sistema
 * operacional não estenda trivialmente o acesso offline. Limitação residual
 * documentada: reiniciar o processo do navegador entre trocas de relógio
 * ainda pode escapar dessa checagem (ver docs/PLANO.md).
 */
export async function storeOfflineSession(params: {
  jwt: string;
  serverTime: string;
}): Promise<OfflineSession> {
  const verified = await verifyOfflineGrantJwt(params.jwt);
  const db = getDb();

  const session: OfflineSession = {
    key: "current",
    userId: verified.payload.sub,
    companyId: verified.payload.companyId,
    deviceId: verified.payload.deviceId,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
    permissionsSnapshot: {
      companyRole: verified.payload.companyRole,
      eventAccess: verified.payload.eventAccess,
    },
    jwt: params.jwt,
    lastVerifiedServerTime: params.serverTime,
    monotonicAnchorMs: performance.now(),
  };

  await db.session.put(session);
  return session;
}

export async function getStoredOfflineSession(): Promise<OfflineSession | undefined> {
  const db = getDb();
  return db.session.get("current");
}

export async function clearOfflineSession(): Promise<void> {
  const db = getDb();
  await db.session.delete("current");
}

export function computeEffectiveNowMs(session: OfflineSession): number {
  const elapsedSinceAnchorMs = performance.now() - session.monotonicAnchorMs;
  return new Date(session.lastVerifiedServerTime).getTime() + elapsedSinceAnchorMs;
}

export interface OfflineSessionCheck {
  valid: boolean;
  reason?: "expired" | "no-session";
  effectiveNowMs: number;
}

export function checkOfflineSessionValidity(
  session: OfflineSession | undefined
): OfflineSessionCheck {
  if (!session) {
    return { valid: false, reason: "no-session", effectiveNowMs: Date.now() };
  }
  const effectiveNowMs = computeEffectiveNowMs(session);
  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (effectiveNowMs >= expiresAtMs) {
    return { valid: false, reason: "expired", effectiveNowMs };
  }
  return { valid: true, effectiveNowMs };
}

export function sessionGrantsEventAccess(session: OfflineSession, eventId: string): boolean {
  return session.permissionsSnapshot.eventAccess.some((a) => a.eventId === eventId);
}
