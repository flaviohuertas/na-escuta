import { NextResponse } from "next/server";
import { ClientInputSchema } from "@/lib/domain/crm.schema";
import { createClient } from "@/server/crm/client.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/** Cadastra um cliente. Exige conexão (é uma ação de gestão). */
export async function POST(request: Request) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const body = await readJsonBody(request, ClientInputSchema);
  if (!body.ok) return body.response;

  try {
    const client = await createClient({ userId: session.userId, companyId: session.companyId, input: body.data });
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
