"use client";

import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalChecklistItem } from "@/lib/db/dexie/schema";
import { createChecklistItem, setChecklistItemStatus } from "@/lib/repositories/checklist.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * Um item do checklist. A linha inteira é o `<label>` do checkbox: o alvo de toque tem 44 px de altura
 * (o quadrado sozinho tem 24). "Obrigatório" é texto, ligado ao campo por `aria-describedby`, e não um
 * asterisco solto.
 */
function ChecklistRow({ item, onToggle }: { item: LocalChecklistItem; onToggle: (item: LocalChecklistItem) => void }) {
  const done = item.status === "DONE";
  const requiredId = `item-${item.id}-required`;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-line bg-white pr-3">
      <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 p-3">
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle(item)}
          aria-describedby={item.isRequired ? requiredId : undefined}
          className="size-6 shrink-0 accent-brand-600"
        />
        <span className={`text-base [overflow-wrap:anywhere] ${done ? "text-slate-600 line-through" : "text-slate-900"}`}>
          {item.label}
        </span>
      </label>
      {item.isRequired && (
        <Badge id={requiredId} tone="neutral">
          Obrigatório
        </Badge>
      )}
    </li>
  );
}

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

  // `undefined` = ainda carregando; `null` = consulta concluída e o checklist não existe neste
  // aparelho (`get()` de id ausente também resolve `undefined`, por isso a normalização).
  const checklist = useLiveQuery(
    async () => (await getDb().checklists.get(checklistId)) ?? null,
    [checklistId]
  );
  const items = useLiveQuery(async () => {
    const db = getDb();
    const rows = await db.checklistItems.where("checklistId").equals(checklistId).toArray();
    return rows.filter((i) => !i.deletedAt).sort((a, b) => a.order - b.order);
  }, [checklistId]);

  function ctx() {
    return { userId, companyId, deviceId: getOrCreateDeviceId() };
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const order = items?.length ?? 0;
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

  if (checklist === undefined) {
    return <LoadingLine />;
  }

  const back = { href: `/eventos/${eventId}/checklists`, label: "Voltar aos checklists" };

  if (checklist === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Checklist não encontrado" back={back} />
        <p className="mt-2 text-sm text-slate-600">
          Este checklist não existe neste aparelho. Ele pode ter sido excluído, ou o evento ainda não
          foi preparado/sincronizado aqui.
        </p>
      </div>
    );
  }

  const doneCount = items?.filter((item) => item.status === "DONE").length ?? 0;
  const totalCount = items?.length ?? 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={checklist.title}
        back={back}
        description={totalCount > 0 ? `${doneCount}/${totalCount} itens concluídos` : undefined}
        actions={<SyncStatusBadge status={checklist.syncStatus} />}
      />
      {items && totalCount > 0 && <ProgressBar done={doneCount} total={totalCount} className="mt-3" />}

      <div className="mt-4">
        {items === undefined ? (
          <LoadingLine />
        ) : items.length === 0 ? (
          <EmptyState hint="Use o campo abaixo para adicionar o primeiro.">Nenhum item ainda.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <ChecklistRow key={item.id} item={item} onToggle={(i) => void toggleItem(i)} />
            ))}
          </ul>
        )}
      </div>

      <Card className="mt-4">
        <form onSubmit={handleAddItem} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field id="item-label" label="Novo item">
            <input
              id="item-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Testar sistema de som"
              className={inputClass}
              required
            />
          </Field>
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            Adicionar
          </Button>
        </form>
        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
      </Card>
    </div>
  );
}
