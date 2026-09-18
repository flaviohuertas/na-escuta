import { z } from "zod";

/**
 * Campos presentes em toda entidade sincronizável. `version`/`updatedAt`/
 * `deletedAt` são geridos pelo servidor (o cliente só os lê); o cliente nunca
 * os define diretamente ao criar/editar — por isso ficam fora dos schemas de
 * "input" de cada domínio e só aparecem nos schemas de "entidade completa".
 */
export const SyncMetaSchema = z.object({
  version: z.number().int().positive(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type SyncMeta = z.infer<typeof SyncMetaSchema>;

export const uuid = () => z.string().uuid();
