import type { AppDatabase } from "@/lib/db/dexie/schema";
import { applyPullResponse, pullChanges } from "./engine";
import { BootstrapResponseSchema, type BootstrapResponse } from "./protocol";
import type { WarmRoutesResult } from "@/lib/offline/warm-routes";

export type PreparePhase = "starting" | "downloading" | "verifying" | "caching" | "done" | "error";

export interface PrepareProgress {
  phase: PreparePhase;
  downloaded: number;
  expected: number;
}

export interface PrepareTypeCount {
  expected: number;
  actual: number;
}

export interface PrepareResult {
  ok: boolean;
  counts: Record<string, PrepareTypeCount>;
  mismatched: string[];
  /** Resultado de guardar as telas do evento para uso sem rede; ausente se `warmRoutes` não foi passado ou lançou erro. */
  routes?: WarmRoutesResult;
}

async function countLocalRows(
  db: AppDatabase,
  eventId: string,
  entityType: string
): Promise<number> {
  switch (entityType) {
    case "Event":
      return (await db.events.get(eventId)) ? 1 : 0;
    case "Task":
      return db.tasks.where("eventId").equals(eventId).filter((t) => !t.deletedAt).count();
    case "ChecklistTemplate":
      return db.checklists.where("eventId").equals(eventId).filter((c) => !c.deletedAt).count();
    case "ChecklistItem":
      return db.checklistItems.where("eventId").equals(eventId).filter((i) => !i.deletedAt).count();
    case "Occurrence":
      return db.occurrences.where("eventId").equals(eventId).filter((o) => !o.deletedAt).count();
    case "OccurrenceEvidence":
      return db.occurrenceEvidence.where("eventId").equals(eventId).filter((e) => !e.deletedAt).count();
    default:
      return 0;
  }
}

/**
 * "Preparar evento para uso offline": baixa evento + tarefas + checklists +
 * ocorrências (+ metadados de evidência) autorizados para este usuário,
 * mostra progresso, e VERIFICA ao final que a contagem local bate com o
 * manifesto do servidor (não basta "terminou sem lançar erro" — cada tipo de
 * registro é contado). Nunca marca o evento como preparado se a verificação
 * falhar.
 */
export async function prepareEventForOffline(
  db: AppDatabase,
  eventId: string,
  opts: {
    fetchImpl?: typeof fetch;
    onProgress?: (progress: PrepareProgress) => void;
    /**
     * Guarda as telas do evento no cache do Service Worker. Roda DEPOIS da verificação de
     * dados e ANTES de marcar o evento como preparado — assim o selo "Disponível offline"
     * só aparece quando as telas realmente já estão guardadas. Falha aqui não invalida os
     * dados baixados (o evento continua sincronizando); só fica registrada em `result.routes`.
     */
    warmRoutes?: (eventId: string) => Promise<WarmRoutesResult>;
  } = {}
): Promise<PrepareResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const onProgress = opts.onProgress ?? (() => {});

  onProgress({ phase: "starting", downloaded: 0, expected: 0 });

  const res = await fetchImpl(`/api/sync/bootstrap?eventId=${encodeURIComponent(eventId)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    onProgress({ phase: "error", downloaded: 0, expected: 0 });
    throw new Error(`Falha ao preparar evento para uso offline (status ${res.status}).`);
  }
  const json = await res.json();
  const parsed: BootstrapResponse = BootstrapResponseSchema.parse(json);

  const expectedTotal = Object.values(parsed.manifest.counts).reduce((sum, n) => sum + n, 0);

  await db.transaction("rw", db.events, async () => {
    await db.events.put({
      id: parsed.event.id,
      companyId: parsed.event.companyId,
      name: parsed.event.name,
      description: parsed.event.description,
      location: parsed.event.location,
      startDate: parsed.event.startDate,
      endDate: parsed.event.endDate,
      status: parsed.event.status,
      version: parsed.event.version,
      syncStatus: "synced",
      createdAt: parsed.event.updatedAt,
      updatedAt: parsed.event.updatedAt,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
    });
  });

  let downloaded = 1; // Event já contabilizado

  await applyPullResponse(db, eventId, {
    changes: parsed.changes,
    nextCursor: parsed.manifest.cursor,
    hasMore: false,
    serverTime: parsed.manifest.serverTime,
    accessRevoked: false,
  });
  downloaded += parsed.changes.length;
  onProgress({ phase: "downloading", downloaded, expected: expectedTotal });

  await pullChanges(db, {
    eventId,
    fetchImpl,
    onPage: (appliedInPage) => {
      downloaded += appliedInPage;
      onProgress({ phase: "downloading", downloaded, expected: expectedTotal });
    },
  });

  onProgress({ phase: "verifying", downloaded, expected: expectedTotal });

  const counts: Record<string, PrepareTypeCount> = {};
  const mismatched: string[] = [];
  for (const [entityType, expected] of Object.entries(parsed.manifest.counts)) {
    const actual = await countLocalRows(db, eventId, entityType);
    counts[entityType] = { expected, actual };
    if (actual !== expected) mismatched.push(entityType);
  }

  const ok = mismatched.length === 0;

  let routes: WarmRoutesResult | undefined;
  if (ok && opts.warmRoutes) {
    onProgress({ phase: "caching", downloaded, expected: expectedTotal });
    try {
      routes = await opts.warmRoutes(eventId);
    } catch {
      routes = undefined;
    }
  }

  await db.transaction("rw", db.syncState, async () => {
    const current = await db.syncState.get(eventId);
    await db.syncState.put({
      key: eventId,
      cursor: current?.cursor ?? parsed.manifest.cursor,
      lastSyncAt: new Date().toISOString(),
      lastFullBootstrapAt: ok ? new Date().toISOString() : current?.lastFullBootstrapAt ?? null,
      expectedCounts: parsed.manifest.counts,
    });
  });

  onProgress({ phase: ok ? "done" : "error", downloaded, expected: expectedTotal });

  return { ok, counts, mismatched, routes };
}

/** Um evento é considerado "disponível offline" só se já passou por um bootstrap com verificação OK. */
export async function isEventPreparedOffline(db: AppDatabase, eventId: string): Promise<boolean> {
  const state = await db.syncState.get(eventId);
  return Boolean(state?.lastFullBootstrapAt);
}

/** Todos os eventos já preparados neste dispositivo — é essa lista que o SyncProvider percorre a cada ciclo de sync. */
export async function listPreparedEventIds(db: AppDatabase): Promise<string[]> {
  const rows = await db.syncState.toArray();
  return rows.filter((r) => r.lastFullBootstrapAt).map((r) => r.key);
}
