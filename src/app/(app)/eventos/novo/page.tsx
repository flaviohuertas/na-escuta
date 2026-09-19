import { AppLink } from "@/components/ui/AppLink";
import { EventForm } from "@/components/events/EventForm";
import { requireSession } from "@/lib/auth/require-session";
import { canCreateEvents } from "@/lib/domain/permissions";
import { getActiveCompanyRole } from "@/server/auth/membership";

/**
 * Renderizada no servidor e SEM cache do Service Worker (ver `isOfflineCacheablePath`): criar
 * evento exige conexão, e a permissão é revalidada no banco a cada abertura.
 */
export default async function NewEventPage() {
  const session = await requireSession();
  const role = await getActiveCompanyRole(session.user.id, session.user.companyId);
  const allowed = role !== null && canCreateEvents(role);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Novo evento</h1>
      {allowed ? (
        <>
          <p className="mt-1 text-sm text-slate-500">Você será o gestor deste evento.</p>
          <EventForm mode="create" />
        </>
      ) : (
        <div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <p>Você não tem permissão para criar eventos nesta empresa.</p>
          <p className="mt-1">Peça a quem administra a empresa para criar o evento ou ajustar o seu papel.</p>
          <AppLink href="/eventos" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
            Voltar aos eventos
          </AppLink>
        </div>
      )}
    </div>
  );
}
