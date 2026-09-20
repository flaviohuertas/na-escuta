import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { ProposeChangeForm, type ProposeFormInitial } from "@/components/approvals/ProposeChangeForm";
import { requireSession } from "@/lib/auth/require-session";
import type { EventStatus } from "@/lib/domain/event.schema";
import { getEventForProposal } from "@/server/approvals/approval.service";
import { AdminActionError } from "@/server/errors";

/**
 * Renderizada no servidor e SEM cache do Service Worker: uma cópia velha do formulário mostraria
 * dados desatualizados, e enviar exige conexão. Quem pode propor (equipe de campo do evento) é
 * revalidado a cada abertura.
 */
export default async function ProposeChangePage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  const { eventId } = await params;

  let initial: ProposeFormInitial;
  try {
    const event = await getEventForProposal({ userId: session.user.id, eventId });
    initial = {
      id: event.id,
      name: event.name,
      description: event.description,
      location: event.location,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      status: event.status as EventStatus,
    };
  } catch (err) {
    if (err instanceof AdminActionError && err.status === 404) notFound();
    if (err instanceof AdminActionError) {
      return (
        <div className="mx-auto max-w-xl">
          <h1 className="text-2xl font-semibold text-slate-900">Propor alteração</h1>
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
      <h1 className="text-2xl font-semibold text-slate-900">Propor alteração</h1>
      <p className="mt-1 text-sm text-slate-500">
        Corrija o que estiver errado em <strong>{initial.name}</strong>. Nada muda agora: o gestor do evento aprova ou
        rejeita, e você acompanha em{" "}
        <AppLink href="/aprovacoes" className="font-medium text-brand-700 hover:underline">
          Aprovações
        </AppLink>
        .
      </p>
      <ProposeChangeForm initial={initial} />
    </div>
  );
}
