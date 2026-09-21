import { z } from "zod";
import { BUDGET_CATEGORY_CODES } from "./budget";
import { optionalDocument, optionalEmail, optionalText } from "./crm.schema";
import { MAX_CONTACT_NAME, MAX_SUPPLIER_NAME, MAX_SUPPLIER_NOTES, SUPPLIER_KINDS } from "./supplier";

/**
 * Estritos como os dos outros módulos de gestão: campo desconhecido (`archivedAt`, `companyId`…)
 * leva 422 em vez de ser ignorado em silêncio. O documento (CPF/CNPJ) é opcional, aceito com ou sem
 * máscara e só entra com os dígitos verificadores certos.
 */
const SupplierFieldsSchema = z.strictObject({
  name: z.string().trim().min(2, "Informe o nome do fornecedor.").max(MAX_SUPPLIER_NAME, "Nome longo demais."),
  kind: z.enum(SUPPLIER_KINDS).default("COMPANY"),
  document: optionalDocument,
  /** Com quem falar (quando o fornecedor é uma empresa). */
  contactName: optionalText(MAX_CONTACT_NAME),
  email: optionalEmail,
  phone: optionalText(40),
  /** A categoria principal (uma das do orçamento) — para achar "quem cotamos para isto". */
  category: z
    .enum(BUDGET_CATEGORY_CODES, { error: "Escolha uma das categorias da lista." })
    .nullish()
    .transform((value) => value ?? null),
  notes: optionalText(MAX_SUPPLIER_NOTES),
});

export const SupplierInputSchema = SupplierFieldsSchema;
export type SupplierInput = z.infer<typeof SupplierInputSchema>;

/** Editar: a versão que a pessoa via — se outra pessoa editou antes, 409. */
export const SupplierUpdateSchema = SupplierFieldsSchema.extend({ baseVersion: z.number().int().positive() });
export type SupplierUpdateInput = z.infer<typeof SupplierUpdateSchema>;

/** Arquivar/reativar (um fornecedor nunca é apagado). */
export const SupplierArchiveSchema = z.strictObject({ archived: z.boolean(), baseVersion: z.number().int().positive() });
export type SupplierArchiveInput = z.infer<typeof SupplierArchiveSchema>;

/**
 * O vínculo de um item (de orçamento ou lançamento) com o cadastro: o id do fornecedor cadastrado,
 * ou `null` quando não há vínculo (aí vale o texto livre). O servidor confere que o fornecedor é
 * desta empresa e não está arquivado.
 */
export const SupplierLinkSchema = z
  .string()
  .uuid("Fornecedor inválido.")
  .nullish()
  .transform((value) => value ?? null);
