import { AppLink } from "@/components/ui/AppLink";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { financeErrorView } from "@/components/finance/FinanceParts";
import { requireSession } from "@/lib/auth/require-session";
import { dateOnlyFromDate } from "@/lib/domain/proposal";
import { AdminActionError } from "@/server/errors";
import { getExpense } from "@/server/finance/finance.service";

/** Editar um lançamento ativo. O estornado não se edita (a tela diz). Ao vivo; fora do cache do Service Worker. */
export default async function EditExpensePage({ params }: { params: Promise<{ eventId: string; expenseId: string }> }) {
  const session = await requireSession();
  const { eventId, expenseId } = await params;

  let data: Awaited<ReturnType<typeof getExpense>>;
  try {
    data = await getExpense({ userId: session.user.id, companyId: session.user.companyId, expenseId });
  } catch (err) {
    return financeErrorView(err);
  }
  const { expense, event } = data;
  // O lançamento tem de ser deste evento: um link com o evento errado é "não existe".
  if (event.id !== eventId) return financeErrorView(new AdminActionError("Lançamento não encontrado.", 404));
  const back = `/financeiro/eventos/${event.id}`;

  return (
    <div className="mx-auto max-w-xl">
      <AppLink href={back} className="text-sm text-slate-600 hover:text-slate-900">
        ← {event.name}
      </AppLink>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Editar lançamento</h1>
      {expense.voidedAt ? (
        <p role="status" className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Este lançamento foi estornado e não pode mais ser editado.
        </p>
      ) : (
        <ExpenseForm
          mode="edit"
          eventId={event.id}
          defaultDate={dateOnlyFromDate(expense.expenseDate)}
          initial={{
            id: expense.id,
            category: expense.category,
            description: expense.description,
            supplier: expense.supplier,
            amountCents: expense.amountCents,
            expenseDate: dateOnlyFromDate(expense.expenseDate),
            notes: expense.notes,
            version: expense.version,
          }}
        />
      )}
    </div>
  );
}
