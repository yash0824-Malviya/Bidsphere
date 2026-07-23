import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";

import {
  getMaterialIssueReceipt,
  signMaterialIssueReceiptAsWarehouse,
} from "../../api/materialIssueReceipt";
import {
  downloadMaterialIssueReceiptPdf,
  printMaterialIssueReceiptPdf,
} from "../../utils/pdf/materialIssueReceiptPdf";
import PageHeader from "../../components/PageHeader";
import MaterialIssueReceiptSignPanel from "../../components/warehouse/receipt/MaterialIssueReceiptSignPanel";
import MaterialIssueReceiptView from "../../components/warehouse/receipt/MaterialIssueReceiptView";
import { useAuthStore } from "../../store/authStore";
import { ownerTitleFromEmail } from "../../config/roles";

export default function WarehouseMaterialIssueReceiptPage() {
  const { name } = useParams<{ name: string }>();
  const issueNumber = name ? decodeURIComponent(name) : "";
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const receiptQuery = useQuery({
    queryKey: ["material-issue-receipt", issueNumber],
    enabled: !!issueNumber,
    queryFn: () => {
      const r = getMaterialIssueReceipt(issueNumber);
      if (!r) throw new Error("Material Issue Receipt not found.");
      return r;
    },
  });

  const receipt = receiptQuery.data;

  const signMut = useMutation({
    mutationFn: (payload: {
      signerName: string;
      signatureType: "drawn" | "typed";
      signatureDataUrl?: string | null;
      typedName?: string;
    }) =>
      signMaterialIssueReceiptAsWarehouse({
        issueNumber,
        ...payload,
      }),
    onSuccess: () => {
      toast.success(
        "Warehouse signed. Status: Waiting for Department Acceptance.",
      );
      void qc.invalidateQueries({
        queryKey: ["material-issue-receipt", issueNumber],
      });
      void qc.invalidateQueries({ queryKey: ["material-issue-receipts"] });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      void qc.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (receiptQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading receipt…
      </div>
    );
  }

  if (receiptQuery.isError || !receipt) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-danger-700">
          {receiptQuery.error instanceof Error
            ? receiptQuery.error.message
            : "Receipt not found."}
        </p>
        <Link
          to="/warehouse/issue-items/receipts"
          className="text-sm text-primary-700 hover:underline"
        >
          Back to Issue Receipts
        </Link>
      </div>
    );
  }

  const canSign = receipt.status === "Waiting Warehouse Signature";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Material Issue Receipt"
        description={receipt.issue_number}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/warehouse/issue-items/receipts"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Issue Receipts
            </Link>
            <button
              type="button"
              onClick={() => void downloadMaterialIssueReceiptPdf(receipt)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => void printMaterialIssueReceiptPdf(receipt)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        }
      />

      <MaterialIssueReceiptView receipt={receipt} audience="warehouse">
        {canSign ? (
          <MaterialIssueReceiptSignPanel
            title="Warehouse Manager Digital Signature"
            subtitle="Sign to submit this receipt for department acceptance."
            defaultName={
              ownerTitleFromEmail(user?.email || user?.name) ||
              user?.full_name ||
              ""
            }
            busy={signMut.isPending}
            onSign={async (payload) => {
              await signMut.mutateAsync(payload);
            }}
          />
        ) : null}
      </MaterialIssueReceiptView>
    </div>
  );
}
