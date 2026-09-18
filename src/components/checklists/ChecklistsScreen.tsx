"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalChecklistTemplate } from "@/lib/db/dexie/schema";
import { createChecklistTemplate } from "@/lib/repositories/checklist.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";

export function ChecklistsScreen({
  eventId,
  userId,
  companyId,
}: {
  eventId: string;
  userId: string;
  companyId: string;
}) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const checklists = useLiveQuery(
    async () => {
      const db = getDb();
      const rows = await db.checklists.where("eventId").equals(eventId).toArray();
      return rows.filter((c) => !c.deletedAt);
    },
    [eventId],
    [] as LocalChecklistTemplate[]
  );

  const itemCounts = useLiveQuery(
    async () => {
      const db = getDb();
      const items = await db.checklistItems.where("eventId").equals(eventId).toArray();
      const map = new Map<string, { total: number; done: number }>();
      for (const item of items) {
        if (item.deletedAt) continue;
        const entry = map.get(item.checklistId) ?? { total: 0, done: 0 };
        entry.total += 1;
        if (item.status === "DONE") entry.done += 1;
        map.set(item.checklistId, entry);
      }
      return map;
    },
    [eventId],
    new Map<string, { total: number; done: number }>()
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createChecklistTemplate(
        { eventId, title: title.trim() },
        { userId, companyId, deviceId: getOrCreateDeviceId() }
      );
      setTitle("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível criar o checklist.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/eventos/${eventId}`} className="text-sm text-brand-600 hover:underline">
        ← Voltar ao evento
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">Checklists</h1>

      <form
        onSubmit={handleCreate}
        className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor="checklist-title" className="block text-xs font-medium text-slate-600">
            Novo checklist
          </label>
          <input
            id="checklist-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Montagem do palco principal"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Criar
        </button>
      </form>
      {formError && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {formError}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {checklists.map((checklist) => {
          const counts = itemCounts.get(checklist.id) ?? { total: 0, done: 0 };
          return (
            <li key={checklist.id}>
              <Link
                href={`/eventos/${eventId}/checklists/${checklist.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-300"
              >
                <div>
                  <p className="font-medium text-slate-900">{checklist.title}</p>
                  <p className="text-xs text-slate-500">
                    {counts.done}/{counts.total} itens concluídos
                  </p>
                </div>
                <SyncStatusBadge status={checklist.syncStatus} />
              </Link>
            </li>
          );
        })}
        {checklists.length === 0 && <p className="text-sm text-slate-500">Nenhum checklist ainda.</p>}
      </ul>
    </div>
  );
}
