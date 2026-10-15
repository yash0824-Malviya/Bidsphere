import { useQuery } from "@tanstack/react-query";
import { fetchECRList } from "../api/ecr";
import { fetchProcurementTruthCounts } from "../api/procurementDashboardTruth";
import { getExactCount } from "../api/erpnext";
import { getApprovedRFQsAwaitingPO } from "../api/purchasing";
import { matchesECRQueueFilter } from "../config/ecrQueues";
import { DASHBOARD_QUERY_OPTIONS } from "../api/queryPresets";

export interface ProcurementBadgeCounts {
  rfqsToCreate: number;
  rfqsPendingPublication: number;
  supplierResponses: number;
  quotesAwaitingEvaluation: number;
  newPoQueue: number;
  // Aliases for compatibility
  ecrsReadyForRfq: number;
  approvalsPending: number;
  isLoading: boolean;
}

export function useProcurementBadges(): ProcurementBadgeCounts {
  // 1. RFQs to Create (ECRs ready for RFQ creation: Procurement Team approved & RFQ not created)
  const ecrQuery = useQuery({
    queryKey: ["ecr-badge-counts"],
    queryFn: () => fetchECRList({ limit: 300 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // 2. RFQs Pending Publication: RFQs with status = Draft
  const rfqDraftQuery = useQuery({
    queryKey: ["rfq-draft-badge-count"],
    queryFn: async () => {
      try {
        const count = await getExactCount("Request for Quotation", [
          ["status", "=", "Draft"],
        ]);
        return count ?? 0;
      } catch {
        return 0;
      }
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // 3. Supplier Responses: Supplier Quotations or responses received
  const supplierResponsesQuery = useQuery({
    queryKey: ["supplier-responses-badge-count"],
    queryFn: async () => {
      try {
        const count = await getExactCount("Supplier Quotation", [
          ["docstatus", "<", 2],
        ]);
        return count ?? 0;
      } catch {
        return 0;
      }
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // 4. Quotes Awaiting Evaluation: pending quotations requiring evaluation
  const truthQuery = useQuery({
    queryKey: ["procurement-truth-badge-count"],
    queryFn: () => fetchProcurementTruthCounts(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // 5. New PO Queue: Approved RFQs awaiting PO creation
  const newPoQueueQuery = useQuery({
    queryKey: ["po-queue-ready-rfqs"],
    queryFn: () => getApprovedRFQsAwaitingPO(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // Compute RFQs to Create directly from ECR query
  let rfqsToCreate = 0;
  if (ecrQuery.data && Array.isArray(ecrQuery.data)) {
    rfqsToCreate = ecrQuery.data.filter((ecr) => matchesECRQueueFilter("rfq-pending", "procurement", ecr)).length;
  }

  const rfqsPendingPublication = rfqDraftQuery.data ?? 0;
  const supplierResponses = supplierResponsesQuery.data ?? 0;
  const quotesAwaitingEvaluation = truthQuery.data?.pendingQuotations ?? 0;
  const newPoQueue = newPoQueueQuery.data?.length ?? 0;

  return {
    rfqsToCreate,
    rfqsPendingPublication,
    supplierResponses,
    quotesAwaitingEvaluation,
    newPoQueue,
    // Aliases
    ecrsReadyForRfq: rfqsToCreate,
    approvalsPending: 0,
    isLoading:
      ecrQuery.isLoading ||
      rfqDraftQuery.isLoading ||
      supplierResponsesQuery.isLoading ||
      truthQuery.isLoading ||
      newPoQueueQuery.isLoading,
  };
}
