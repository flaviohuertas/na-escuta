import { ApprovalInbox } from "@/components/approvals/ApprovalInbox";
import { MyProposals } from "@/components/approvals/MyProposals";
import { requireSession } from "@/lib/auth/require-session";
import { canReviewProposals } from "@/lib/domain/permissions";
import { listMyProposals, listProposalsForReview } from "@/server/approvals/approval.service";
import { listAccessibleEvents } from "@/server/events/accessible-events";

/**
 * Aprovações: o que espera a SUA decisão (se você gerencia algum evento) e as propostas que VOCÊ fez.
 * Renderizada no servidor e fora do cache do Service Worker — é informação ao vivo, e decidir exige conexão.
 */
export default async function ApprovalsPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const events = await listAccessibleEvents(userId);
  const isReviewer = events.some(({ role }) => canReviewProposals(role));

  const [review, mine] = await Promise.all([
    isReviewer ? listProposalsForReview(userId) : Promise.resolve(null),
    listMyProposals(userId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Aprovações</h1>
      <p className="mt-1 text-sm text-slate-500">
        A equipe de campo propõe correções nos dados do evento; o gestor do evento aprova ou rejeita.
      </p>

      {review && (
        <section aria-labelledby="to-decide" className="mt-6">
          <h2 id="to-decide" className="text-lg font-semibold text-slate-900">
            Para decidir
            {review.pending.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{review.pending.length}</span>
            )}
          </h2>
          <ApprovalInbox pending={review.pending} decided={review.decided} />
        </section>
      )}

      <section aria-labelledby="mine" className="mt-8">
        <h2 id="mine" className="text-lg font-semibold text-slate-900">
          Minhas propostas
        </h2>
        <MyProposals proposals={mine} />
      </section>
    </div>
  );
}
