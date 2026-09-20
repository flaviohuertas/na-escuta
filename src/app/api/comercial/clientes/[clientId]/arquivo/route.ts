import { NextResponse } from "next/server";
import { ClientArchiveSchema } from "@/lib/domain/crm.schema";
import { setClientArchived } from "@/server/crm/client.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Arquiva ou reativa um cliente (ele nunca é apagado). Recusa arquivar quem tem oportunidade em andamento. */
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { clientId } = await params;
  const body = await readJsonBody(request, ClientArchiveSchema);
  if (!body.ok) return body.response;

  try {
    const client = await setClientArchived({
      userId: session.userId,
      companyId: session.companyId,
      clientId,
      archived: body.data.archived,
      baseVersion: body.data.baseVersion,
    });
    return NextResponse.json({ client });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
