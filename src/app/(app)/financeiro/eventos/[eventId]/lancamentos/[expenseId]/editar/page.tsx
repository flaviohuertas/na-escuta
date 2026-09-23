import { PageHeader } from "@/components/ui/PageHeader";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { financeErrorView } from "@/components/finance/FinanceParts";
import { requireSession } from "@/lib/auth/require-session";
import { dateOnlyFromDate } from "@/lib/domain/proposal";
import { AdminActionError } from "@/server/errors";
import { getExpense } from "@/server/finance/finance.service";
import { listSupplierOptions } from "@/server/suppliers/supplier.service";

/** Editar um lançamento ativo. O estornado não se edita (a tela diz). Ao vivo; fora do cache do Service Worker. */
export default async function EditExpensePage({ params }: { params: Promise<{ eventId: string; expenseId: string }> }) {
  const session = await requireSession();
  const { eventId, expenseId } = await params;

  let data: Awaited<ReturnType<typeof getExpense>>;
  let suppliers: Awaited<ReturnType<typeof listSupplierOptions>>;
  try {
    const ctx = { userId: session.user.id, companyId: session.user.companyId };
    data = await getExpense({ ...ctx, expenseId });
    // Os ativos e o que o lançamento já cita (mesmo arquivado, para não perder o vínculo ao editar).
    suppliers = await listSupplierOptions({ ...ctx, alsoIds: data.expense.supplierId ? [data.expense.supplierId] : [] });
  } catch (err) {
    return financeErrorView(err);
  }
  const { expense, event } = data;
  // O lançamento tem de ser deste evento: um link com o evento errado é "não existe".
  if (event.id !== eventId) return financeErrorView(new AdminActionError("Lançamento não encontrado.", 404));
  const back = `/financeiro/eventos/${event.id}`;

  return (
    <div className="max-w-xl">
      <PageHeader back={{ href: back, label: event.name }} title="Editar lançamento" />
      {expense.voidedAt ? (
        <p role="status" className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Este lançamento foi estornado e não pode mais ser editado.
        </p>
      ) : (
        <ExpenseForm
          mode="edit"
          eventId={event.id}
          defaultDate={dateOnlyFromDate(expense.expenseDate)}
          suppliers={suppliers}
          initial={{
            id: expense.id,
            category: expense.category,
            description: expense.description,
            supplier: expense.supplier,
            supplierId: expense.supplierId,
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
