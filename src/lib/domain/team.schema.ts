import { z } from "zod";
import { AccessStatusSchema, CompanyRoleSchema } from "./access.schema";

/**
 * O e-mail é a chave de login. Sempre minúsculo e sem espaços nas pontas: sem isso "Ana@x.com"
 * cadastrado pela administração e "ana@x.com" digitado no login seriam duas pessoas diferentes.
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-mail longo demais.")
  .pipe(z.email("Informe um e-mail válido."));

/** Cadastrar uma pessoa na equipe da empresa. */
export const AddMemberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da pessoa.").max(120, "Nome longo demais."),
  email: EmailSchema,
  role: CompanyRoleSchema,
});

/** Mudar o papel na empresa, encerrar/reativar o vínculo ou desativar/reativar a conta. */
export const ChangeMemberSchema = z
  .object({
    role: CompanyRoleSchema.optional(),
    status: AccessStatusSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined || v.isActive !== undefined, {
    message: "Informe o papel, a situação ou a conta.",
  });
