import { Suspense } from "react";
import { requireSession } from "@/lib/auth/require-session";
import { OccurrenceDetailFromQuery } from "@/components/occurrences/OccurrenceDetailFromQuery";

/**
 * Detalhe da ocorrência numa rota FIXA (`?id=`): o HTML guardado pelo Service Worker serve para
 * qualquer id, inclusive ocorrências criadas offline (ver `occurrenceDetailHref`).
 */
export default async function OccurrenceDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  return (
    <Suspense fallback={<p className="text-slate-500">Carregando…</p>}>
      <OccurrenceDetailFromQuery
        eventId={eventId}
        userId={session.user.id}
        companyId={session.user.companyId}
      />
    </Suspense>
  );
}
