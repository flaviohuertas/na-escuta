import { requireSession } from "@/lib/auth/require-session";
import { ChecklistDetailScreen } from "@/components/checklists/ChecklistDetailScreen";

export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; checklistId: string }>;
}) {
  const { eventId, checklistId } = await params;
  const session = await requireSession();

  return (
    <ChecklistDetailScreen
      eventId={eventId}
      checklistId={checklistId}
      userId={session.user.id}
      companyId={session.user.companyId}
    />
  );
}
