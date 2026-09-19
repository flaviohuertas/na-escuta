import type { LocalEvent } from "@/lib/db/dexie/schema";
import type { EventSnapshot } from "./protocol";

/**
 * O evento como fica no IndexedDB, a partir do que o servidor mandou. O evento é somente-leitura
 * no aparelho (não vai pela outbox), então `syncStatus` é sempre "synced" e o servidor é a única
 * fonte da verdade — quem cria/edita evento faz isso online.
 */
export function eventFromSnapshot(snapshot: EventSnapshot, existing?: LocalEvent): LocalEvent {
  return {
    id: snapshot.id,
    companyId: snapshot.companyId,
    name: snapshot.name,
    description: snapshot.description,
    location: snapshot.location,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    status: snapshot.status,
    version: snapshot.version,
    syncStatus: "synced",
    createdAt: existing?.createdAt ?? snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
    deletedAt: null,
    createdBy: existing?.createdBy ?? null,
    updatedBy: existing?.updatedBy ?? null,
  };
}
