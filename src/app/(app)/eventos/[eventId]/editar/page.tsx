import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { EventForm, type EventFormInitial } from "@/components/events/EventForm";
import { requireSession } from "@/lib/auth/require-session";
import type { EventStatus } from "@/lib/domain/event.schema";
import { EventForbiddenError, EventNotFoundError, getEventForEditing } from "@/server/events/event.service";

/**
 * Renderizada no servidor e SEM cache do Service Worker: uma cópia velha do formulário
 * mostraria dados desatualizados. A permissão (gestor do evento) é revalidada a cada abertura.
 */
export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  const { eventId } = await params;

  let initial: EventFormInitial;
  try {
    const event = await getEventForEditing({ userId: session.user.id, eventId });
    initial = {
      id: event.id,
      name: event.name,
      description: event.description,
      location: event.location,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      status: event.status as EventStatus,
      version: event.version,
    };
  } catch (err) {
    if (err instanceof EventNotFoundError) notFound();
    if (err instanceof EventForbiddenError) {
      return (
        <div className="mx-auto max-w-xl">
          <h1 className="text-2xl font-semibold text-slate-900">Editar evento</h1>
          <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
            <p>{err.message}</p>
            <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
              Voltar aos eventos
            </AppLink>
          </div>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Editar evento</h1>
      <p className="mt-1 text-sm text-slate-500">
        As alterações chegam aos aparelhos que já prepararam este evento no próximo sincronismo.
      </p>
      <EventForm mode="edit" initial={initial} />
    </div>
  );
}
