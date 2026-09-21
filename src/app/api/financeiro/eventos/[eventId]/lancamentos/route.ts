import { NextResponse } from "next/server";
import { ExpenseInputSchema } from "@/lib/domain/finance.schema";
import { createExpense } from "@/server/finance/finance.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { financeSession } from "@/server/http/finance-session";

/** Lança um custo realizado no evento. 403 para quem não vê o financeiro; 404 se o evento não é desta empresa. */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await financeSession();
  if (!session.ok) return session.response;
  const { eventId } = await params;
  const body = await readJsonBody(request, ExpenseInputSchema);
  if (!body.ok) return body.response;

  try {
    const expense = await createExpense({ userId: session.userId, companyId: session.companyId, eventId, input: body.data });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
