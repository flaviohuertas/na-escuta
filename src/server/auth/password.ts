import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";
import type { ChangePasswordInput } from "@/lib/domain/password.schema";
import { AdminActionError } from "@/server/errors";
import { bumpSessionVersion } from "./session-version";

const BCRYPT_COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Sem 0/O, 1/l/I: uma senha que será LIDA e digitada por alguém não pode ter caracteres que se confundem. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Senha provisória: 12 caracteres sorteados com `crypto.randomInt` (não `Math.random`), em três
 * grupos de quatro para ler e digitar (`Xk7m-Pq2w-Hd9r`). ~69 bits de entropia — e vale só até a
 * primeira troca, que é obrigatória.
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 12 }, () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

/**
 * A pessoa troca a PRÓPRIA senha (a provisória ou uma que ela já tinha). Exige a senha atual,
 * limpa a marca de "troca obrigatória" e audita — sem NUNCA gravar senha ou hash no histórico.
 *
 * Derruba TODAS as sessões abertas dela, inclusive a que fez a troca: quem trocou a senha porque
 * suspeita de um segundo aparelho não pode ficar com ele ainda logado. Por isso devolve o e-mail:
 * quem chama reemite a sessão atual com a versão nova (ver `POST /api/conta/senha`).
 */
export async function changeOwnPassword(userId: string, input: ChangePasswordInput): Promise<{ email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, isActive: true, email: true },
  });
  if (!user || !user.isActive) {
    throw new AdminActionError("Conta não encontrada ou desativada.", 403);
  }
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AdminActionError("A senha atual não confere.", 422);
  }

  const newHash = await hashPassword(input.newPassword);
  const membership = await prisma.membership.findFirst({
    where: { userId, status: AccessStatus.ACTIVE },
    orderBy: { createdAt: "asc" },
    select: { companyId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash, mustChangePassword: false } });
    await bumpSessionVersion(tx, userId);
    if (membership) {
      await tx.auditLog.create({
        data: {
          companyId: membership.companyId,
          userId,
          entityType: "User",
          entityId: userId,
          action: "PASSWORD_CHANGED",
        },
      });
    }
  });
  return { email: user.email };
}
