import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { EventAccessManager } from "@/components/admin/EventAccessManager";
import { requireSession } from "@/lib/auth/require-session";
import type { EventRoleName } from "@/lib/domain/permissions";
import { prisma } from "@/lib/db/prisma";
import { EventForbiddenError, EventNotFoundError } from "@/server/events/event.service";
import { listEventAccess } from "@/server/events/event-access.service";

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
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold text-slate-900">Pessoas do evento</h1>
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

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Pessoas do evento</h1>
      <p className="mt-1 text-sm text-slate-500">
        {event.name} — quem pode ver e mexer neste evento. Retirar o acesso vale já no próximo sincronismo
        de cada aparelho.
      </p>
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
