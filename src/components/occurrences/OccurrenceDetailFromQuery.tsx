"use client";

import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
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
      <div className="mx-auto max-w-2xl">
        <AppLink href={`/eventos/${eventId}/ocorrencias`} className="text-sm text-brand-600 hover:underline">
          ← Voltar às ocorrências
        </AppLink>
        <p className="mt-3 text-slate-600">Nenhuma ocorrência foi indicada.</p>
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
