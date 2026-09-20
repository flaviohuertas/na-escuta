import { NextResponse } from "next/server";
import { ClientUpdateSchema } from "@/lib/domain/crm.schema";
import { updateClient } from "@/server/crm/client.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Edita o cadastro do cliente (com a versão que a pessoa via: outra edição no meio dá 409). */
export async function PATCH(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { clientId } = await params;
  const body = await readJsonBody(request, ClientUpdateSchema);
  if (!body.ok) return body.response;

  try {
    const client = await updateClient({ userId: session.userId, companyId: session.companyId, clientId, input: body.data });
    return NextResponse.json({ client });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
