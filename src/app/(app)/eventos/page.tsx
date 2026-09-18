import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db/prisma";
import { AccessStatus } from "@/generated/prisma/enums";

function formatDateRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/**
 * Catálogo de eventos acessíveis — busca ao vivo no servidor (exige conexão
 * na primeira vez, como documentado). Depois de "preparado", cada evento
 * passa a abrir e funcionar via IndexedDB, sem depender mais desta página.
 */
export default async function EventsPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const accessRows = await prisma.eventAccess.findMany({
    where: { userId, status: AccessStatus.ACTIVE, event: { deletedAt: null } },
    include: { event: true },
    orderBy: { event: { startDate: "asc" } },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Eventos</h1>
      <p className="mt-1 text-sm text-slate-500">
        Selecione um evento para ver detalhes e prepará-lo para uso offline.
      </p>

      {accessRows.length === 0 ? (
        <p className="mt-6 text-slate-500">Você ainda não tem acesso a nenhum evento.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {accessRows.map(({ event, role }) => (
            <li key={event.id}>
              <Link
                href={`/eventos/${event.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-medium text-slate-900">{event.name}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {role === "MANAGER" ? "Gestor" : role === "FIELD_STAFF" ? "Equipe de campo" : "Visualização"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDateRange(event.startDate, event.endDate)}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
