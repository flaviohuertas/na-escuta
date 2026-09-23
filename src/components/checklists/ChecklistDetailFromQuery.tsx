"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
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
      <div className="max-w-2xl">
        <PageHeader
          title="Checklist"
          description="Nenhum checklist foi indicado."
          back={{ href: `/eventos/${eventId}/checklists`, label: "Voltar aos checklists" }}
        />
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
