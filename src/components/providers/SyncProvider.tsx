"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { listPreparedEventIds } from "@/lib/sync/bootstrap";
import { connectivityMonitor, type ConnectivityState } from "@/lib/sync/connectivity";
import { runFullSyncCycleLocked } from "@/lib/sync/engine";

export type SyncPhase = "idle" | "syncing" | "error";

interface SyncContextValue {
  connectivity: ConnectivityState;
  phase: SyncPhase;
  lastError: string | null;
  lastSyncAt: string | null;
  pendingCount: number;
  conflictCount: number;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncStatus(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSyncStatus deve ser usado dentro de <SyncProvider>.");
  return ctx;
}

/**
 * Dispara sincronização ao abrir o app, ao recuperar conectividade e expõe
 * `syncNow` para o comando manual — as três formas exigidas, sem depender
 * exclusivamente de Background Sync. Percorre todos os eventos já
 * "preparados offline" neste dispositivo (não só o que está aberto na tela).
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [connectivity, setConnectivity] = useState<ConnectivityState>(connectivityMonitor.getState());
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const pendingCount =
    useLiveQuery(
      async () => {
        const db = getDb();
        return db.outbox
          .where("status")
          .anyOf(["PENDING", "SENDING", "FAILED"])
          .count();
      },
      [],
      0
    ) ?? 0;

  const conflictCount =
    useLiveQuery(
      async () => {
        const db = getDb();
        return db.conflicts.where("status").equals("PENDING").count();
      },
      [],
      0
    ) ?? 0;

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setPhase("syncing");
    setLastError(null);
    try {
      const db = getDb();
      const online = await connectivityMonitor.checkNow();
      if (!online) {
        setPhase("idle");
        return;
      }
      const deviceId = getOrCreateDeviceId();
      const eventIds = await listPreparedEventIds(db);
      for (const eventId of eventIds) {
        const result = await runFullSyncCycleLocked(db, { eventId, deviceId });
        if (result === "skipped-locked") break;
      }
      setLastSyncAt(new Date().toISOString());
      setPhase("idle");
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Erro desconhecido ao sincronizar.");
      setPhase("error");
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const detach = connectivityMonitor.attachBrowserListeners();
    const unsubscribe = connectivityMonitor.subscribe(setConnectivity);
    void connectivityMonitor.checkNow();
    return () => {
      detach();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // syncNow atualiza estado logo nas primeiras linhas (antes de qualquer
    // await); chamá-la direto aqui contaria como setState síncrono dentro do
    // efeito. queueMicrotask adia para depois do commit deste efeito.
    queueMicrotask(() => {
      void syncNow(); // ao abrir o app
    });
  }, [syncNow]);

  useEffect(() => {
    if (connectivity.status !== "online") return;
    queueMicrotask(() => {
      void syncNow(); // ao recuperar conectividade
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectivity.status]);

  const value: SyncContextValue = {
    connectivity,
    phase,
    lastError,
    lastSyncAt,
    pendingCount,
    conflictCount,
    syncNow,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
