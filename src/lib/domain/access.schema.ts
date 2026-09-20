import { z } from "zod";
import { COMPANY_ROLES, EVENT_ROLES } from "./permissions";

export const EventRoleSchema = z.enum(EVENT_ROLES);
export const CompanyRoleSchema = z.enum(COMPANY_ROLES);
export const AccessStatusSchema = z.enum(["ACTIVE", "REVOKED"]);

/** Dar (ou devolver) acesso a um evento. */
export const GrantEventAccessSchema = z.object({
  userId: z.string().uuid(),
  role: EventRoleSchema,
});

/** Mudar o papel de alguém no evento e/ou revogar/reativar. Pelo menos um dos dois. */
export const ChangeEventAccessSchema = z
  .object({
    role: EventRoleSchema.optional(),
    status: AccessStatusSchema.optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "Informe o papel ou a situação.",
  });
