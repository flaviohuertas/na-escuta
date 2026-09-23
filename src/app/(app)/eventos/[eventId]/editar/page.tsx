import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { EventForm, type EventFormInitial } from "@/components/events/EventForm";
import { requireSession } from "@/lib/auth/require-session";
import type { EventStatus } from "@/lib/domain/event.schema";
import { EventForbiddenError, EventNotFoundError, getEventForEditing } from "@/server/events/event.service";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";

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
        <div className="max-w-xl">
          <PageHeader title="Editar evento" description={err.message} />
          <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
            Voltar aos eventos
          </AppLink>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        back={{ href: "/eventos", label: "Eventos" }}
        title="Editar evento"
        description="As alterações chegam aos aparelhos que já prepararam este evento no próximo sincronismo."
      />
      <EventForm mode="edit" initial={initial} />
    </div>
  );
}
