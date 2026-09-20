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

/**
 * Hash de uma senha descartável. Conta inexistente também gasta um `bcrypt.compare`: sem isso a
 * resposta de "e-mail que não existe" é medivelmente mais rápida que a de "senha errada", e o
 * login revelaria quais e-mails têm conta.
 */
const DUMMY_HASH = "$2b$10$AF0wRbIqt0YILDrlskUBuONpylljV6m.ZhIe.ucaHDPpGgFjQyetG";

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
  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive || !passwordOk) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: AccessStatus.ACTIVE },
    select: { id: true },
  });
  if (!membership) return null;

  return { id: user.id, email: user.email, name: user.name };
}
