"use client";

import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { ChecklistDetailScreen } from "./ChecklistDetailScreen";

/**
 * Lê o id do checklist da query (`?id=`) — ver `checklistDetailHref` para o porquê da rota fixa.
 * Precisa ficar dentro de um `<Suspense>` (exigência do Next para `useSearchParams`).
 */
export function ChecklistDetailFromQuery({
  eventId,
  userId,
  companyId,
}: {
  eventId: string;
  userId: string;
  companyId: string;
}) {
  const checklistId = useSearchParams().get("id");

  if (!checklistId) {
    return (
      <div className="mx-auto max-w-2xl">
        <AppLink href={`/eventos/${eventId}/checklists`} className="text-sm text-brand-600 hover:underline">
          ← Voltar aos checklists
        </AppLink>
        <p className="mt-3 text-slate-600">Nenhum checklist foi indicado.</p>
      </div>
    );
  }

  return (
    <ChecklistDetailScreen
      eventId={eventId}
      checklistId={checklistId}
      userId={userId}
      companyId={companyId}
    />
  );
}
