import { AppLink } from "@/components/ui/AppLink";
import { EventForm } from "@/components/events/EventForm";
import { requireSession } from "@/lib/auth/require-session";
import { canCreateEvents } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";

/**
 * Renderizada no servidor e SEM cache do Service Worker (ver `isOfflineCacheablePath`): criar
 * evento exige conexão, e a permissão é revalidada no banco a cada abertura.
 */
export default async function NewEventPage() {
  const session = await requireSession();
  const role = await getActiveCompanyRole(session.user.id, session.user.companyId);
  const allowed = role !== null && canCreateEvents(role);

  return (
    <div className="max-w-xl">
      {allowed ? (
        <>
          <PageHeader back={{ href: "/eventos", label: "Eventos" }} title="Novo evento" description="Você será o gestor deste evento." />
          <EventForm mode="create" />
        </>
      ) : (
        <>
          <PageHeader
            title="Novo evento"
            description={
              <>
                <span>Você não tem permissão para criar eventos nesta empresa.</span> Peça a quem administra a empresa para criar o
                evento ou ajustar o seu papel.
              </>
            }
          />
          <AppLink href="/eventos" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
            Voltar aos eventos
          </AppLink>
        </>
      )}
    </div>
  );
}
