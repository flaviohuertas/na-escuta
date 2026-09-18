import { importJWK, SignJWT } from "jose";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

function getPrivateKeyJwk(): Record<string, unknown> {
  const raw = process.env.OFFLINE_GRANT_PRIVATE_KEY_JWK;
  if (!raw) {
    throw new Error(
      "OFFLINE_GRANT_PRIVATE_KEY_JWK não configurado — rode `npm run keys:generate`."
    );
  }
  return JSON.parse(raw);
}

export interface IssueOfflineGrantParams {
  userId: string;
  companyId: string;
  deviceId: string;
  deviceLabel?: string;
}

export interface IssuedOfflineGrant {
  jwt: string;
  serverTime: string;
  expiresAt: string;
}

/**
 * Emite o grant offline: um JWT assinado com EdDSA (Ed25519) contendo um
 * retrato (snapshot) das permissões do usuário na empresa e nos eventos, com
 * validade de `Company.offlineAccessDays`. Só pode ser chamado com uma sessão
 * web já autenticada e válida (verificado pela rota que chama este serviço)
 * — o grant offline nunca é, ele próprio, usado para autorizar uma operação
 * de sync no servidor; ele só autoriza o app a abrir e operar localmente.
 */
export async function issueOfflineGrant(
  params: IssueOfflineGrantParams
): Promise<IssuedOfflineGrant> {
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: params.userId, companyId: params.companyId } },
    include: { company: true },
  });

  if (!membership || membership.status !== AccessStatus.ACTIVE) {
    throw new Error("Usuário sem vínculo ativo com esta empresa.");
  }

  const eventAccessRows = await prisma.eventAccess.findMany({
    where: {
      userId: params.userId,
      status: AccessStatus.ACTIVE,
      event: { companyId: params.companyId, deletedAt: null },
    },
    select: { eventId: true, role: true },
  });

  const key = await importJWK(getPrivateKeyJwk(), "EdDSA");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + membership.company.offlineAccessDays * 24 * 60 * 60 * 1000
  );

  const jwt = await new SignJWT({
    companyId: params.companyId,
    deviceId: params.deviceId,
    companyRole: membership.role,
    eventAccess: eventAccessRows.map((row) => ({ eventId: row.eventId, role: row.role })),
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(params.userId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(key);

  await prisma.device.upsert({
    where: { id: params.deviceId },
    create: {
      id: params.deviceId,
      userId: params.userId,
      companyId: params.companyId,
      label: params.deviceLabel,
      offlineTokenIssuedAt: now,
      offlineTokenExpiresAt: expiresAt,
    },
    update: {
      offlineTokenIssuedAt: now,
      offlineTokenExpiresAt: expiresAt,
      lastSeenAt: now,
      revokedAt: null,
    },
  });

  return { jwt, serverTime: now.toISOString(), expiresAt: expiresAt.toISOString() };
}

/** Usado pela sincronização para rejeitar operações de um dispositivo cujo grant foi revogado. */
export async function isDeviceRevoked(deviceId: string): Promise<boolean> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  return Boolean(device?.revokedAt);
}
