"use client";

import { useState, type FormEvent } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { checklistDetailHref } from "@/lib/offline/routes";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import { createChecklistTemplate } from "@/lib/repositories/checklist.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, cardClass } from "@/components/ui/Card";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";

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

  // `undefined` = o aparelho ainda está lendo; a lista vazia só aparece depois da leitura.
  const checklists = useLiveQuery(async () => {
    const db = getDb();
    const rows = await db.checklists.where("eventId").equals(eventId).toArray();
    return rows.filter((c) => !c.deletedAt);
  }, [eventId]);

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
      <PageHeader title="Checklists" back={{ href: `/eventos/${eventId}`, label: "Voltar ao evento" }} />

      <Card className="mt-4">
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field id="checklist-title" label="Novo checklist">
            <input
              id="checklist-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Montagem do palco principal"
              className={inputClass}
              required
            />
          </Field>
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            Criar
          </Button>
        </form>
        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
      </Card>

      <div className="mt-4">
        {checklists === undefined ? (
          <LoadingLine />
        ) : checklists.length === 0 ? (
          <EmptyState hint="Use o campo acima para criar o primeiro.">Nenhum checklist ainda.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {checklists.map((checklist) => {
              const counts = itemCounts.get(checklist.id) ?? { total: 0, done: 0 };
              return (
                <li key={checklist.id}>
                  <AppLink
                    href={checklistDetailHref(eventId, checklist.id)}
                    className={cardClass({ interactive: true, className: "block" })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{checklist.title}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {counts.done}/{counts.total} itens concluídos
                        </p>
                      </div>
                      <SyncStatusBadge status={checklist.syncStatus} />
                    </div>
                    <ProgressBar done={counts.done} total={counts.total} className="mt-3" />
                  </AppLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
