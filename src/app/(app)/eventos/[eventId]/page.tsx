import { EventWorkspace, type EventSummary } from "@/components/events/EventWorkspace";
import { requireSession } from "@/lib/auth/require-session";
import { findAccessibleEvent } from "@/server/events/accessible-events";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  // Só o resumo, para a tela de "ainda não preparado" dizer QUAL evento é. Os dados de trabalho
  // continuam vindo do aparelho (IndexedDB): sem internet, esta tela sai do cache e lê o Dexie.
  const access = await findAccessibleEvent(session.user.id, eventId);
  const summary: EventSummary | null = access
    ? {
        name: access.event.name,
        startDate: access.event.startDate.toISOString(),
        endDate: access.event.endDate.toISOString(),
        location: access.event.location,
      }
    : null;

  return <EventWorkspace eventId={eventId} summary={summary} />;
}
