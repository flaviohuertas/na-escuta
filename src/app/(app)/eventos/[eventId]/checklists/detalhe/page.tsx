import { Suspense } from "react";
import { requireSession } from "@/lib/auth/require-session";
import { ChecklistDetailFromQuery } from "@/components/checklists/ChecklistDetailFromQuery";

/**
 * Detalhe do checklist numa rota FIXA (`?id=`): o HTML guardado pelo Service Worker serve para
 * qualquer id, inclusive checklists criados offline (ver `checklistDetailHref`).
 */
export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession();

  return (
    <Suspense fallback={<p className="text-slate-500">Carregando…</p>}>
      <ChecklistDetailFromQuery
        eventId={eventId}
        userId={session.user.id}
        companyId={session.user.companyId}
      />
    </Suspense>
  );
}
