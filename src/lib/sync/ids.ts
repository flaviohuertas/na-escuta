import { v7 as uuidv7, validate as validateUuid } from "uuid";

/**
 * Gera um novo identificador de entidade no cliente (UUIDv7).
 *
 * UUIDv7 é usado (em vez de ULID) porque: cabe nativamente numa coluna `uuid`
 * do Postgres sem conversão, mantém ordenação temporal (bom para os cursores
 * de sincronização baseados em updatedAt+id) e não exige nenhuma lib extra
 * além do `uuid`, que já usamos.
 */
export function generateEntityId(): string {
  return uuidv7();
}

/**
 * Gera um id de operação de outbox — também UUIDv7. É este id que serve de
 * chave de idempotência no servidor (SyncOutboxLog.id): reenviar a mesma
 * operação nunca duplica o efeito.
 */
export function generateOperationId(): string {
  return uuidv7();
}

export function isValidEntityId(value: string): boolean {
  return validateUuid(value);
}
