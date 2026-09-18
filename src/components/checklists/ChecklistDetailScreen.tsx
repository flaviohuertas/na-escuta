"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalChecklistItem } from "@/lib/db/dexie/schema";
import { createChecklistItem, setChecklistItemStatus } from "@/lib/repositories/checklist.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";

export function ChecklistDetailScreen({
  eventId,
  checklistId,
  userId,
  companyId,
}: {
  eventId: string;
  checklistId: string;
  userId: string;
  companyId: string;
}) {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const checklist = useLiveQuery(() => getDb().checklists.get(checklistId), [checklistId]);
  const items = useLiveQuery(
    async () => {
      const db = getDb();
      const rows = await db.checklistItems.where("checklistId").equals(checklistId).toArray();
      return rows.filter((i) => !i.deletedAt).sort((a, b) => a.order - b.order);
    },
    [checklistId],
    [] as LocalChecklistItem[]
  );

  function ctx() {
    return { userId, companyId, deviceId: getOrCreateDeviceId() };
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const order = items.length;
      await createChecklistItem({ checklistId, eventId, label: label.trim(), order }, ctx());
      setLabel("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível adicionar o item.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleItem(item: LocalChecklistItem) {
    const next = item.status === "DONE" ? "PENDING" : "DONE";
    await setChecklistItemStatus(item.id, next, ctx());
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/eventos/${eventId}/checklists`} className="text-sm text-brand-600 hover:underline">
        ← Voltar aos checklists
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">{checklist?.title ?? "Checklist"}</h1>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
          >
            <input
              id={`item-${item.id}`}
              type="checkbox"
              checked={item.status === "DONE"}
              onChange={() => void toggleItem(item)}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label
              htmlFor={`item-${item.id}`}
              className={`flex-1 text-sm ${item.status === "DONE" ? "text-slate-400 line-through" : "text-slate-800"}`}
            >
              {item.label}
              {item.isRequired && <span className="ml-1 text-status-error">*</span>}
            </label>
          </li>
        ))}
        {items.length === 0 && <p className="text-sm text-slate-500">Nenhum item ainda.</p>}
      </ul>

      <form onSubmit={handleAddItem} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="item-label" className="block text-xs font-medium text-slate-600">
            Novo item
          </label>
          <input
            id="item-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Testar sistema de som"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Adicionar
        </button>
      </form>
      {formError && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {formError}
        </p>
      )}
    </div>
  );
}
