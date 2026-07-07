import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Briefcase, CheckCircle2, Eye, Loader2, XCircle } from "lucide-react";

import {
  approveIndirectMaterialRequest,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
  rejectIndirectMaterialRequest,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import StatusBadge from "../StatusBadge";
import ProcurementTypeBadge from "../ProcurementTypeBadge";
import ConfirmDialog from "../ui/ConfirmDialog";
import { formatCurrency, formatDate } from "../../utils/format";

type Decision = "approve" | "reject";

export default function AdminIndirectApprovalPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{
    mr: MaterialRequestWorkflowRecord;
    decision: Decision;
  } | null>(null);
  const [remarks, setRemarks] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-indirect-approvals"],
    queryFn: () => listMaterialRequestsWorkflow({ docstatus: 1, limit: 500 }),
    refetchInterval: 30_000,
  });

  const indirect = useMemo(
    () =>
      data.filter((mr) => getMaterialRequestProcurementType(mr) === "Indirect"),
    [data],
  );

  const pending = useMemo(
    () =>
      indirect.filter(
        (mr) => getMaterialRequestWorkflowStatus(mr) === "Admin Review",
      ),
    [indirect],
  );

  const history = useMemo(
    () =>
      indirect
        .filter(
          (mr) => getMaterialRequestWorkflowStatus(mr) !== "Admin Review",
        )
        .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))
        .slice(0, 10),
    [indirect],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-indirect-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["material-requests-workflow"] });
    queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
    queryClient.invalidateQueries({ queryKey: ["mr-dashboard-counts"] });
  };

  const mutation = useMutation({
    mutationFn: async ({
      mr,
      decision,
      note,
    }: {
      mr: MaterialRequestWorkflowRecord;
      decision: Decision;
      note: string;
    }) => {
      if (decision === "approve") {
        return approveIndirectMaterialRequest(mr.name, note || undefined);
      }
      return rejectIndirectMaterialRequest(mr.name, note || undefined);
    },
    onSuccess: (_res, vars) => {
      toast.success(
        vars.decision === "approve"
          ? t("adminReview.approved")
          : t("adminReview.rejected"),
      );
      setDialog(null);
      setRemarks("");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Action failed"),
  });

  return (
    <div className="space-y-4">
      {/* Pending queue */}
      <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
            <Briefcase className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              {t("adminReview.title")}
            </h3>
            <p className="text-[11px] text-neutral-500">
              {t("adminReview.subtitle")}
            </p>
          </div>
          {pending.length > 0 && (
            <span className="ml-auto flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-100 px-2 text-xs font-bold text-orange-700">
              {pending.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        ) : pending.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-500">
            {t("adminReview.noPending")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">{t("adminReview.mrNumber")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.department")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.requestedBy")}</th>
                  <th className="px-4 py-2.5">{t("procurementType.label")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.priority")}</th>
                  <th className="px-4 py-2.5 text-right">
                    {t("adminReview.estimatedCost")}
                  </th>
                  <th className="px-4 py-2.5">{t("adminReview.requestDate")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.status")}</th>
                  <th className="px-4 py-2.5 text-right">
                    {t("adminReview.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {pending.map((mr) => (
                  <tr key={mr.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/material-requests/${encodeURIComponent(mr.name)}`}
                        className="font-semibold text-primary-600 no-underline"
                      >
                        {mr.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {mr.custom_department ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {mr.custom_requested_by ?? mr.owner ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <ProcurementTypeBadge
                        type={getMaterialRequestProcurementType(mr)}
                      />
                    </td>
                    <td className="px-4 py-2.5">{mr.custom_priority ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {mr.total ? formatCurrency(mr.total) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {formatDate(mr.transaction_date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        status={getMaterialRequestWorkflowStatus(mr)}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setRemarks("");
                            setDialog({ mr, decision: "approve" });
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t("adminReview.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRemarks("");
                            setDialog({ mr, decision: "reject" });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t("adminReview.reject")}
                        </button>
                        <Link
                          to={`/material-requests/${encodeURIComponent(mr.name)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 no-underline hover:bg-neutral-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t("adminReview.viewDetails")}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approval history */}
      <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-bold text-neutral-900">
            {t("adminReview.approvalHistory")}
          </h3>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            {t("adminReview.noHistory")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">{t("adminReview.mrNumber")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.department")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.decision")}</th>
                  <th className="px-4 py-2.5">{t("adminReview.decidedOn")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {history.map((mr) => (
                  <tr key={mr.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/material-requests/${encodeURIComponent(mr.name)}`}
                        className="font-semibold text-primary-600 no-underline"
                      >
                        {mr.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {mr.custom_department ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        status={getMaterialRequestWorkflowStatus(mr)}
                      />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-neutral-500">
                      {formatDate(mr.modified)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <ConfirmDialog
          open
          onClose={() => {
            if (!mutation.isPending) {
              setDialog(null);
              setRemarks("");
            }
          }}
          onConfirm={() =>
            mutation.mutate({
              mr: dialog.mr,
              decision: dialog.decision,
              note: remarks.trim(),
            })
          }
          title={
            dialog.decision === "approve"
              ? t("adminReview.approveTitle")
              : t("adminReview.rejectTitle")
          }
          description={
            dialog.decision === "approve"
              ? t("adminReview.approveBody", { name: dialog.mr.name })
              : t("adminReview.rejectBody", { name: dialog.mr.name })
          }
          confirmLabel={
            dialog.decision === "approve"
              ? t("adminReview.approve")
              : t("adminReview.reject")
          }
          tone={dialog.decision === "approve" ? "primary" : "danger"}
          isLoading={mutation.isPending}
        >
          <label className="block text-xs font-semibold text-neutral-600">
            {dialog.decision === "approve"
              ? t("adminReview.remarksLabel")
              : t("adminReview.rejectReasonLabel")}
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}
