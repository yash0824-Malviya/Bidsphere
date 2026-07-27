import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";

import {
  getMaterialIssueReceiptAsync,
  rejectMaterialIssueReceipt,
  signMaterialIssueReceiptAsDepartment,
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
import {
  ACCEPTANCE_CHECKLIST_LABELS,
  EMPTY_ACCEPTANCE_CHECKLIST,
  isAcceptanceChecklistComplete,
  type MaterialIssueAcceptanceChecklist,
} from "../../types/materialIssueReceipt";
import DepartmentIssuedItemsPage from "./DepartmentIssuedItemsPage";

/** @deprecated Prefer DepartmentIssuedItemsPage — kept for route compatibility. */
export function DepartmentMaterialReceiptsListPage() {
  return <DepartmentIssuedItemsPage mode="pending" />;
}

export default function DepartmentMaterialIssueConfirmPage() {
  const { name } = useParams<{ name: string }>();
  const issueNumber = name ? decodeURIComponent(name) : "";
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const [checklist, setChecklist] = useState<MaterialIssueAcceptanceChecklist>({
    ...EMPTY_ACCEPTANCE_CHECKLIST,
  });
  const [departmentRemarks, setDepartmentRemarks] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showSign, setShowSign] = useState(false);

  const receiptQuery = useQuery({
    queryKey: ["material-issue-receipt", issueNumber],
    enabled: !!issueNumber,
    queryFn: async () => {
      const r = await getMaterialIssueReceiptAsync(issueNumber);
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
      signMaterialIssueReceiptAsDepartment({
        issueNumber,
        ...payload,
        checklist,
        departmentRemarks,
      }),
    onSuccess: () => {
      toast.success(
        "Material accepted. Issue Receipt recorded · Material Request Completed.",
      );
      setShowSign(false);
      void qc.invalidateQueries({
        queryKey: ["material-issue-receipt", issueNumber],
      });
      void qc.invalidateQueries({
        queryKey: ["material-issue-receipts"],
      });
      void qc.invalidateQueries({
        queryKey: ["department-issued-items"],
      });
      void qc.invalidateQueries({ queryKey: ["material-request"] });
      void qc.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
      navigate("/department/issued-items/issue-receipts");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: () =>
      rejectMaterialIssueReceipt({
        issueNumber,
        rejectedBy:
          ownerTitleFromEmail(user?.email || user?.name) ||
          user?.full_name ||
          "Department User",
        reason: rejectReason,
      }),
    onSuccess: () => {
      toast.success("Acceptance rejected. Warehouse has been notified.");
      setRejectOpen(false);
      void qc.invalidateQueries({
        queryKey: ["material-issue-receipt", issueNumber],
      });
      void qc.invalidateQueries({
        queryKey: ["material-issue-receipts"],
      });
      void qc.invalidateQueries({
        queryKey: ["department-issued-items"],
      });
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
          to="/department/issued-items/pending-acceptance"
          className="text-sm text-primary-700 hover:underline"
        >
          Back to Pending Acceptance
        </Link>
      </div>
    );
  }

  const canAccept = receipt.status === "Pending Department Acceptance";
  const checklistOk = isAcceptanceChecklistComplete(checklist);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Confirm Material Receipt"
        description="Verify quantities and condition, then digitally accept materials."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/department/issued-items/pending-acceptance"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Pending Acceptance
            </Link>
            <button
              type="button"
              onClick={() => void downloadMaterialIssueReceiptPdf(receipt)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => void printMaterialIssueReceiptPdf(receipt)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        }
      />

      <MaterialIssueReceiptView receipt={receipt} audience="department">
        {canAccept ? (
          <div className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Acceptance Checklist
            </h2>
            <ul className="space-y-2">
              {(
                Object.keys(ACCEPTANCE_CHECKLIST_LABELS) as Array<
                  keyof MaterialIssueAcceptanceChecklist
                >
              ).map((key) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={checklist[key]}
                      onChange={(e) =>
                        setChecklist((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary-600"
                    />
                    {ACCEPTANCE_CHECKLIST_LABELS[key]}
                  </label>
                </li>
              ))}
            </ul>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Department Remarks
              </span>
              <textarea
                rows={3}
                value={departmentRemarks}
                onChange={(e) => setDepartmentRemarks(e.target.value)}
                placeholder="Optional notes about the received materials…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!checklistOk}
                onClick={() => {
                  if (!checklistOk) {
                    toast.error("Complete all checklist items first.");
                    return;
                  }
                  setShowSign(true);
                }}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Accept Material
              </button>
              <button
                type="button"
                onClick={() => setRejectOpen(true)}
                className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100"
              >
                Report Issue
              </button>
            </div>

            {showSign ? (
              <MaterialIssueReceiptSignPanel
                title="Department Digital Signature"
                subtitle="Sign to accept material. Receipt is saved under Issue Receipts."
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
          </div>
        ) : null}
      </MaterialIssueReceiptView>

      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              Report Issue with Receipt
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Warehouse will be notified. Status becomes Acceptance Rejected.
            </p>
            <textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Describe the issue…"
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rejectMut.isPending}
                onClick={() => rejectMut.mutate()}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {rejectMut.isPending ? "Submitting…" : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
