import { redirect } from "next/navigation";
import { occurrenceDetailHref } from "@/lib/offline/routes";

/**
 * URL antiga (`/ocorrencias/[id]`): mantida só para links já compartilhados. O detalhe vive em
 * `/ocorrencias/detalhe?id=` porque uma rota por id não pode ser aberta offline para registros
 * criados no aparelho (ver `occurrenceDetailHref`).
 */
export default async function LegacyOccurrenceDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; occurrenceId: string }>;
}) {
  const { eventId, occurrenceId } = await params;
  redirect(occurrenceDetailHref(eventId, occurrenceId));
}
