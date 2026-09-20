import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;

/** O bcrypt só usa os 72 primeiros BYTES da senha: além disso a senha seria truncada em silêncio. */
export const PASSWORD_MAX_BYTES = 72;

const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A nova senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
    message: `A nova senha é longa demais (no máximo ${PASSWORD_MAX_BYTES} bytes).`,
  });

/** Trocar a própria senha: a atual comprova que é a pessoa (e não uma sessão esquecida aberta). */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: NewPasswordSchema,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "A nova senha precisa ser diferente da atual.",
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
