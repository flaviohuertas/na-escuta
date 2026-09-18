import { requireSession } from "@/lib/auth/require-session";
import { OccurrenceDetailScreen } from "@/components/occurrences/OccurrenceDetailScreen";

export default async function OcorrenciaDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; occurrenceId: string }>;
}) {
  const { eventId, occurrenceId } = await params;
  const session = await requireSession();

  return (
    <OccurrenceDetailScreen
      eventId={eventId}
      occurrenceId={occurrenceId}
      userId={session.user.id}
      companyId={session.user.companyId}
    />
  );
}
