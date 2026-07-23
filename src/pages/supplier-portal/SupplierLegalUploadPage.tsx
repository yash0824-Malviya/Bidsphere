import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

import { getLegalDocs } from "../../api/legalDocs";
import { getSupplierQuotation } from "../../api/sourcing";
import SupplierLegalDocuments from "../../components/supplier/SupplierLegalDocuments";
import { Skeleton } from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { isSelectedAsWinner } from "../../utils/supplierLegalDocs";

export default function SupplierLegalUploadPage() {
  const { sqName = "" } = useParams<{ sqName: string }>();
  const navigate = useNavigate();
  const supplierSession = JSON.parse(
    sessionStorage.getItem("supplier_session") || "{}"
  );
  const supplierName: string = supplierSession.supplierName || "";

  const sqQuery = useQuery({
    queryKey: ["supplier-quotation-detail", sqName],
    enabled: !!sqName,
    queryFn: () => getSupplierQuotation(sqName),
  });

  const reviewQuery = useQuery({
    queryKey: ["supplier-legal-review", sqName],
    enabled: !!sqName,
    queryFn: () => getLegalDocs(sqName),
    staleTime: 30_000,
  });

  const sq = sqQuery.data;
  const review = reviewQuery.data ?? null;

  const refetch = async () => {
    await Promise.all([sqQuery.refetch(), reviewQuery.refetch()]);
  };

  if (sqQuery.isLoading) {
    return (
      
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      
    );
  }

  if (sqQuery.isError || !sq) {
    return (
      
        <Link
          to="/supplier/quotations"
          className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-accent-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to quotations
        </Link>
        <EmptyState
          icon={FileText}
          title="Quotation not found"
          description={`Supplier Quotation "${sqName}" could not be loaded.`}
        />
      
    );
  }

  const winnerLocked = isSelectedAsWinner(review);

  return (
    
      <div className="mb-4">
        <Link
          to="/supplier/quotations"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-accent-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to quotations
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-neutral-900">
          <ShieldCheck className="h-7 w-7 text-accent-600" />
          Legal &amp; Compliance Documents
        </h1>
        <p className="text-sm text-neutral-600">
          Legal documents for Supplier Quotation{" "}
          <strong className="text-neutral-900">{sqName}</strong>.
          {winnerLocked
            ? " These documents are locked because your quotation is under legal review."
            : " You can upload or replace documents until Procurement selects the winning supplier."}
        </p>
      </div>

      <div className="max-w-3xl">
        <SupplierLegalDocuments
          sq={sq}
          review={review}
          editable={!winnerLocked}
          onChanged={refetch}
        />

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => {
              toast.success("Documents saved.");
              navigate("/supplier/quotations");
            }}
            className="btn-touch inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
          >
            Done
          </button>
        </div>
      </div>
    
  );
}
