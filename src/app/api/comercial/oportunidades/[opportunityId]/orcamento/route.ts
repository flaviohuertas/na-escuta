import { NextResponse } from "next/server";
import { BudgetSaveSchema } from "@/lib/domain/budget.schema";
import { saveBudget } from "@/server/crm/budget.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { crmSession } from "@/server/http/crm-session";

/**
 * Salva o orçamento interno da oportunidade (cria na primeira vez, com `baseVersion` 0; depois troca
 * os itens). 409 se outra pessoa salvou antes ou se a oportunidade não pode mais mudar (perdida ou
 * já virou evento). 403 para quem não vê o orçamento.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await crmSession();
  if (!session.ok) return session.response;
  const { opportunityId } = await params;
  const body = await readJsonBody(request, BudgetSaveSchema);
  if (!body.ok) return body.response;

  try {
    const budget = await saveBudget({ userId: session.userId, companyId: session.companyId, opportunityId, input: body.data });
    return NextResponse.json({ budget });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
