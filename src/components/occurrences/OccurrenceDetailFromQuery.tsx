"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { OccurrenceDetailScreen } from "./OccurrenceDetailScreen";

/**
 * Lê o id da ocorrência da query (`?id=`) — ver `occurrenceDetailHref` para o porquê da rota fixa.
 * Precisa ficar dentro de um `<Suspense>` (exigência do Next para `useSearchParams`).
 */
export function OccurrenceDetailFromQuery({
  eventId,
  userId,
  companyId,
}: {
  eventId: string;
  userId: string;
  companyId: string;
}) {
  const occurrenceId = useSearchParams().get("id");

  if (!occurrenceId) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Ocorrência"
          description="Nenhuma ocorrência foi indicada."
          back={{ href: `/eventos/${eventId}/ocorrencias`, label: "Voltar às ocorrências" }}
        />
      </div>
    );
  }

  return (
    <OccurrenceDetailScreen
      eventId={eventId}
      occurrenceId={occurrenceId}
      userId={userId}
      companyId={companyId}
    />
  );
}
