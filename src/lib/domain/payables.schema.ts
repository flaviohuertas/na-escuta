import { z } from "zod";
import { MAX_VALUE_CENTS, onlyDigits } from "./crm";
import { SupplierLinkSchema } from "./supplier.schema";
import { DateOnlySchema } from "./proposal.schema";

export const PAYABLE_KINDS = ["PAYABLE", "RECEIVABLE"] as const;
export type PayableKindName = (typeof PAYABLE_KINDS)[number];

export const PayableKindSchema = z.enum(PAYABLE_KINDS);

const PayableFieldsSchema = z.strictObject({
  kind: PayableKindSchema.default("PAYABLE"),
  title: z.string().trim().min(2, "Informe o título da conta.").max(200, "Título longo demais."),
  amountCents: z
    .number()
    .int("O valor precisa estar em centavos.")
    .min(1, "O valor precisa ser maior que zero.")
    .max(MAX_VALUE_CENTS, "Valor acima do limite de R$ 20 milhões."),
  dueDate: DateOnlySchema,
  paidAt: DateOnlySchema.nullish().transform((value) => value ?? null),
  cancelledAt: DateOnlySchema.nullish().transform((value) => value ?? null),
  notes: z.string().trim().max(2000, "Observações longas demais.").nullish().transform((value) => (value ? value : null)),
  cancelReason: z.string().trim().max(500, "Motivo longo demais.").nullish().transform((value) => (value ? value : null)),
  eventId: z.string().trim().uuid("Evento inválido.").nullish().transform((value) => value ?? null),
  supplierId: SupplierLinkSchema,
  supplierDocument: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? onlyDigits(value) : null))
    .refine((value) => value === null || value.length >= 11, { message: "Documento do fornecedor inválido." }),
});

export const PayableInputSchema = PayableFieldsSchema;
export type PayableInput = z.infer<typeof PayableInputSchema>;

export const PayableUpdateSchema = PayableFieldsSchema.extend({ baseVersion: z.number().int().positive() });
export type PayableUpdateInput = z.infer<typeof PayableUpdateSchema>;

export const PayablePaymentSchema = z.strictObject({
  paidAt: DateOnlySchema,
  baseVersion: z.number().int().positive(),
});
export type PayablePaymentInput = z.infer<typeof PayablePaymentSchema>;

export const PayableCancelSchema = z.strictObject({
  cancelledAt: DateOnlySchema,
  cancelReason: z.string().trim().min(3, "Diga por que a conta foi cancelada.").max(500, "Motivo longo demais."),
  baseVersion: z.number().int().positive(),
});
export type PayableCancelInput = z.infer<typeof PayableCancelSchema>;
