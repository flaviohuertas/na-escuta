import { errors, importJWK, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

/**
 * O aparelho ainda pode ter os dados desta pessoa?
 *
 * É o único canal que funciona SEM sessão: quem teve o vínculo encerrado tem a sessão derrubada
 * (o servidor devolve 401 a tudo) e o login recusado, então o aparelho não tem como descobrir por
 * `/api/sync`. O que ele guarda é o grant offline — um JWT assinado pelo servidor — e é ele que
 * apresenta aqui. O grant não autoriza NADA no servidor além desta pergunta: só prova de quem é o
 * aparelho, e a resposta diz se aquela pessoa, naquela empresa, ainda vale.
 */

export type DeviceRevokedReason = "ACCOUNT_DISABLED" | "MEMBERSHIP_REVOKED" | "DEVICE_REVOKED";

export type DeviceVerdict = { status: "valid" } | { status: "revoked"; reason: DeviceRevokedReason };

/** O grant não é nosso (assinatura ruim, formato estranho). NUNCA vira um veredito: só "não sei". */
export class InvalidGrantError extends Error {
  constructor(message = "Grant offline inválido.") {
    super(message);
    this.name = "InvalidGrantError";
  }
}

const GrantClaimsSchema = z.object({
  sub: z.string().uuid(),
  companyId: z.string().uuid(),
  deviceId: z.string().min(1),
});

/** A chave PÚBLICA sai da privada (o servidor sempre a tem): não há segunda variável para ficar fora de sincronia. */
function publicKeyJwk(): Record<string, unknown> {
  const raw = process.env.OFFLINE_GRANT_PRIVATE_KEY_JWK;
  if (!raw) {
    throw new Error("OFFLINE_GRANT_PRIVATE_KEY_JWK não configurado — rode `npm run keys:generate`.");
  }
  const jwk = JSON.parse(raw) as Record<string, unknown>;
  delete jwk.d; // o componente privado do par Ed25519
  return jwk;
}

async function readGrantClaims(jwt: string): Promise<z.infer<typeof GrantClaimsSchema>> {
  const key = await importJWK(publicKeyJwk(), "EdDSA");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(jwt, key, { algorithms: ["EdDSA"] }));
  } catch (err) {
    // Grant VENCIDO continua provando quem é o aparelho (a assinatura é conferida antes das datas), e
    // é justamente o aparelho parado há dias que mais precisa saber que perdeu o acesso.
    if (err instanceof errors.JWTExpired) payload = err.payload;
    else throw new InvalidGrantError();
  }
  const claims = GrantClaimsSchema.safeParse(payload);
  if (!claims.success) throw new InvalidGrantError("Grant offline com claims inválidas.");
  return claims.data;
}

/**
 * Julga o grant contra o banco AGORA (nada é confiado ao que o grant dizia quando foi emitido).
 * `valid` só quando a conta está ativa, o vínculo com a empresa está ativo e o dispositivo não foi
 * revogado. Lança `InvalidGrantError` se o grant não for autêntico.
 */
export async function evaluateDeviceGrant(jwt: string): Promise<DeviceVerdict> {
  const claims = await readGrantClaims(jwt);

  const [user, membership, device] = await Promise.all([
    prisma.user.findUnique({ where: { id: claims.sub }, select: { isActive: true } }),
    prisma.membership.findUnique({
      where: { userId_companyId: { userId: claims.sub, companyId: claims.companyId } },
      select: { status: true },
    }),
    prisma.device.findUnique({ where: { id: claims.deviceId }, select: { userId: true, revokedAt: true } }),
  ]);

  if (!user?.isActive) return { status: "revoked", reason: "ACCOUNT_DISABLED" };
  if (!membership || membership.status !== AccessStatus.ACTIVE) return { status: "revoked", reason: "MEMBERSHIP_REVOKED" };
  // O id do dispositivo vem do cliente: só vale a linha que é DESTA pessoa (nunca julga por um id alheio).
  if (device && device.userId === claims.sub && device.revokedAt) return { status: "revoked", reason: "DEVICE_REVOKED" };
  return { status: "valid" };
}
