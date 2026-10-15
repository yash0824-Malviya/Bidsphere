import { recordRfqAwardDecision } from "./clm";
import { getLegalDocsByRfq } from "./legalDocs";
import { getReverseBidding, isApproved, sameSupplier, sendAuctionWinnerToReview } from "./reverseBidding";

/** Apply the saved RFQ contract requirement after the reverse-auction award persists. */
export async function confirmReverseAuctionContractDecision(input: {
  auction: string;
  rfq: string;
  supplier: string;
  finalAwardValue: number;
  submittedBy?: string;
  override?: { supplier: string; price?: number };
}) {
  const current = await getReverseBidding(input.auction);
  if (current.rfq !== input.rfq) throw new Error("The auction does not belong to this RFQ. Refresh the saved award.");
  // Preserve the existing award API. A decision retry must not replay sourcing
  // transitions after a saved Yes decision has activated the CLM gate.
  const auction = isApproved(current) ? current : await sendAuctionWinnerToReview(input.auction, input.submittedBy, input.override);
  const award = await getLegalDocsByRfq(input.rfq);
  if (!award?.name || !award.sq_name || award.rfq_name !== input.rfq || !sameSupplier(award.supplier, input.supplier)) {
    throw new Error("The supplier award was not saved with the expected RFQ and quotation. Refresh the award before recording its contract decision.");
  }
  if (!(input.finalAwardValue > 0) || !Number.isFinite(Number(award.grand_total)) || Math.abs(Number(award.grand_total) - input.finalAwardValue) > 0.005) {
    throw new Error("The saved award value does not match the final reverse-bid amount. Reconcile the award before recording its contract decision.");
  }
  const result = await recordRfqAwardDecision({
    rfq: input.rfq,
    award_id: award.name,
    quotation_id: award.sq_name,
    supplier_id: award.supplier,
  });
  return { auction, result };
}
