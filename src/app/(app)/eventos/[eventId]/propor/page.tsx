import { notFound } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { ProposeChangeForm, type ProposeFormInitial } from "@/components/approvals/ProposeChangeForm";
import { requireSession } from "@/lib/auth/require-session";
import type { EventStatus } from "@/lib/domain/event.schema";
import { getEventForProposal } from "@/server/approvals/approval.service";
import { AdminActionError } from "@/server/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";

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
        <div className="max-w-xl">
          <PageHeader title="Propor alteração" description={err.message} />
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
        title="Propor alteração"
        description={
          <>
            Corrija o que estiver errado em <strong>{initial.name}</strong>. Nada muda agora: o gestor do evento aprova ou
            rejeita, e você acompanha em{" "}
            <AppLink href="/aprovacoes" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
              Aprovações
            </AppLink>
            .
          </>
        }
      />
      <ProposeChangeForm initial={initial} />
    </div>
  );
}
