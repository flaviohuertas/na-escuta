import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { EventAccessManager } from "@/components/admin/EventAccessManager";
import { requireSession } from "@/lib/auth/require-session";
import type { EventRoleName } from "@/lib/domain/permissions";
import { prisma } from "@/lib/db/prisma";
import { EventForbiddenError, EventNotFoundError } from "@/server/events/event.service";
import { listEventAccess } from "@/server/events/event-access.service";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";

/**
 * Renderizada no servidor e FORA do cache do Service Worker: quem tem acesso é uma informação
 * ao vivo, e mudar exige conexão. Só o gestor do evento abre; a permissão é revalidada no banco.
 */
export default async function EventAccessPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  const { eventId } = await params;

  let data: Awaited<ReturnType<typeof listEventAccess>>;
  try {
    data = await listEventAccess({ actorId: session.user.id, eventId });
  } catch (err) {
    if (err instanceof EventNotFoundError) notFound();
    if (err instanceof EventForbiddenError) {
      return (
        <div className="max-w-3xl">
          <PageHeader title="Pessoas do evento" description={err.message} />
          <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
            Voltar aos eventos
          </AppLink>
        </div>
      );
    }
    throw err;
  }

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } });

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: `/eventos/${eventId}`, label: event.name }}
        title="Pessoas do evento"
        description="Quem pode ver e mexer neste evento. Retirar o acesso vale já no próximo sincronismo de cada aparelho."
      />
      <EventAccessManager
        eventId={eventId}
        rows={data.rows.map((r) => ({
          userId: r.userId,
          name: r.name,
          email: r.email,
          role: r.role as EventRoleName,
          status: r.status,
          membershipActive: r.membershipActive,
        }))}
        candidates={data.candidates}
      />
    </div>
  );
}
