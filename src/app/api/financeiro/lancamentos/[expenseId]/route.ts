import { NextResponse } from "next/server";
import { ExpenseUpdateSchema } from "@/lib/domain/finance.schema";
import { updateExpense } from "@/server/finance/finance.service";
import { domainErrorResponse, readJsonBody } from "@/server/http/responses";
import { financeSession } from "@/server/http/finance-session";

/** Edita um lançamento ativo. 409 se já foi estornado ou se outra pessoa mexeu antes (versão). */
export async function PATCH(request: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const session = await financeSession();
  if (!session.ok) return session.response;
  const { expenseId } = await params;
  const body = await readJsonBody(request, ExpenseUpdateSchema);
  if (!body.ok) return body.response;

  try {
    const expense = await updateExpense({ userId: session.userId, companyId: session.companyId, expenseId, input: body.data });
    return NextResponse.json({ expense });
  } catch (err) {
    const response = domainErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
