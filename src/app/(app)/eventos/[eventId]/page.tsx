import { EventWorkspace } from "@/components/events/EventWorkspace";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventWorkspace eventId={eventId} />;
}
