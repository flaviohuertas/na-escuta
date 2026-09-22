import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";
import { EmailSchema } from "@/lib/domain/team.schema";
import { verifyPassword } from "./password";

const CredentialsSchema = z.object({
  // Minúsculo e sem espaços nas pontas, como o e-mail é gravado no cadastro (ver EmailSchema):
  // "Ana@X.com" digitado no login e "ana@x.com" cadastrado são a MESMA pessoa.
  email: EmailSchema,
  password: z.string().min(1),
});

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginLockState = "clear" | "blocked";

/**
 * Hash de uma senha descartável. Conta inexistente também gasta um `bcrypt.compare`: sem isso a
 * resposta de "e-mail que não existe" é medivelmente mais rápida que a de "senha errada", e o
 * login revelaria quais e-mails têm conta.
 */
const DUMMY_HASH = "$2b$10$AF0wRbIqt0YILDrlskUBuONpylljV6m.ZhIe.ucaHDPpGgFjQyetG";

/**
 * Informa se a conta já está em lockout por excesso de tentativas. Não revela a existência de
 * e-mails inexistentes: o comportamento para e-mail desconhecido é sempre "clear".
 */
export async function getLoginLockState(email: string | null | undefined): Promise<LoginLockState> {
  const normalized = EmailSchema.safeParse(email ?? "");
  if (!normalized.success) return "clear";

  const user = await prisma.user.findUnique({
    where: { email: normalized.data },
    select: { lockedUntil: true },
  });
  if (!user?.lockedUntil) return "clear";

  const now = new Date();
  if (user.lockedUntil.getTime() > now.getTime()) return "blocked";

  await prisma.user.update({
    where: { email: normalized.data },
    data: { lockedUntil: null, failedLoginAttempts: 0 },
  });
  return "clear";
}

/**
 * Confere e-mail e senha. `null` para qualquer falha — formato inválido, conta inexistente,
 * conta desativada, sem vínculo ativo com uma empresa ou senha errada — sem dizer qual: quem erra
 * não descobre nada sobre as contas.
 *
 * Sem vínculo ativo não há o que abrir: as telas exigem uma empresa, e uma sessão sem ela cai num
 * laço entre `/login` (que manda quem tem sessão para o app) e o app (que manda quem não tem
 * empresa para `/login`). É o caso de quem teve o vínculo encerrado e tenta entrar de novo.
 */
export async function authenticateCredentials(
  raw: unknown
): Promise<{ id: string; email: string; name: string } | null> {
  const parsed = CredentialsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const now = new Date();

  if (user) {
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      return null;
    }
    if (user.lockedUntil && user.lockedUntil.getTime() <= now.getTime()) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
      });
    }
  }

  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive || !passwordOk) {
    if (user) {
      const nextAttempts = user.failedLoginAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          lockedUntil: nextAttempts >= MAX_LOGIN_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null,
        },
      });
    }
    return null;
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: AccessStatus.ACTIVE },
    select: { id: true },
  });
  if (!membership) return null;

  return { id: user.id, email: user.email, name: user.name };
}
