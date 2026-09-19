import { redirect } from "next/navigation";
import { checklistDetailHref } from "@/lib/offline/routes";

/**
 * URL antiga (`/checklists/[id]`): mantida só para links já compartilhados. O detalhe vive em
 * `/checklists/detalhe?id=` porque uma rota por id não pode ser aberta offline para registros
 * criados no aparelho (ver `checklistDetailHref`).
 */
export default async function LegacyChecklistDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; checklistId: string }>;
}) {
  const { eventId, checklistId } = await params;
  redirect(checklistDetailHref(eventId, checklistId));
}
