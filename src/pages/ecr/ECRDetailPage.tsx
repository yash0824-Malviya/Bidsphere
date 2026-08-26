import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  RefreshCw,
  FileText,
  MessageSquare,
  Send,
  Download,
  ShieldCheck,
  Boxes,
  FileCode,
  Building2,
  Layers,
  Eye,
  Trash2,
  UploadCloud,
  Paperclip,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  fetchECR,
  applyECRWorkflowAction,
  getECRComments,
  createRFQFromECR,
} from "../../api/ecr";
import {
  fetchECRAttachments,
  deleteECRAttachment,
  uploadECRAttachment,
  type ECRAttachment,
  type ECRAttachmentCategory,
} from "../../api/ecrAttachments";
import { useAuthStore } from "../../store/authStore";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import {
  ECR_WORKSPACES,
  canAccessECRRecord,
  canEditECR,
  canonicalECRStage,
  formatECRNumber,
  getECRStatusCardInfo,
  isECRRole,
} from "../../config/ecrRoles";
import AccessDenied from "../../components/AccessDenied";
import ECRApprovalHistory from "../../components/ecr/ECRApprovalHistory";
import ECRApprovalPanel from "../../components/ecr/ECRApprovalPanel";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import ECRWorkflowStepper from "../../components/ecr/ECRWorkflowStepper";
import {
  canCreateECRRFQ,
  getECRProcurementStatus,
  getECRProcurementTraceability,
  getECRRFQReference,
  hasReachedECRApproval,
  isECRSupplierSourcingRequired,
} from "../../components/ecr/ecrDetailModel";
import { formatMediumDisplayDate } from "../../utils/erpNextDate";

type DetailTab =
  | "overview"
  | "parts"
  | "impacts"
  | "documents"
  | "procurement";

export default function ECRDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [commentText, setCommentText] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [rfqLoading, setRfqLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const {
    data: ecr,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["ecr", name],
    queryFn: () => fetchECR(name!),
    enabled: !!name,
  });

  useEffect(() => {
    if (!ecr || !name) return;
    const publicNumber = formatECRNumber(ecr);
    if (name.toUpperCase() !== publicNumber.toUpperCase()) {
      navigate(`/ecr/${encodeURIComponent(publicNumber)}`, { replace: true });
    }
  }, [ecr, name, navigate]);

  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ["ecr-comments", ecr?.name],
    queryFn: () => getECRComments(ecr!.name),
    enabled: Boolean(ecr?.name),
  });

  const attachmentsQuery = useQuery({
    queryKey: ["ecr-attachments", ecr?.name],
    queryFn: () => fetchECRAttachments(ecr!.name, ecr),
    enabled: Boolean(ecr?.name),
  });
  const attachments = attachmentsQuery.data || [];

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (att: ECRAttachment) => {
      await deleteECRAttachment(att.id, ecr!.name, att.category, att.field_name);
      return att;
    },
    onSuccess: () => {
      toast.success("Document removed.");
      void qc.invalidateQueries({ queryKey: ["ecr-attachments", ecr?.name] });
      void qc.invalidateQueries({ queryKey: ["ecr", name] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to remove document.");
    },
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: ECRAttachmentCategory }) => {
      return uploadECRAttachment(file, ecr!.name, category, undefined, user?.email || user?.name || "Engineer");
    },
    onSuccess: () => {
      toast.success("Document uploaded successfully.");
      void qc.invalidateQueries({ queryKey: ["ecr-attachments", ecr?.name] });
      void qc.invalidateQueries({ queryKey: ["ecr", name] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to upload document.");
    },
  });

  const workflowMutation = useMutation({
    mutationFn: ({
      action,
      cmt,
      reviewFields,
    }: {
      action: string;
      cmt?: string;
      reviewFields?: Record<string, string>;
    }) => {
      const ecrIdentifier = ecr?.name || ecr?.ecr_number || name || "";
      return applyECRWorkflowAction(ecrIdentifier, action, cmt, ecr, reviewFields);
    },
    onSuccess: (res) => {
      if (res.success) {
        setFeedback({ type: "success", msg: res.message || `Action "${activeAction}" applied successfully.` });
        setActiveAction(null);
        setCommentText("");
        qc.setQueryData<EngineeringChangeRequest | undefined>(["ecr", name], (current) =>
          current
            ? {
                ...current,
                select_pxfp: res.newStatus ?? current.select_pxfp,
                status: res.newStatus ?? current.status,
                approval_requirements:
                  res.approvalRequirements ?? current.approval_requirements,
              }
            : current,
        );
        void qc.invalidateQueries({ queryKey: ["ecr", name] });
        void qc.invalidateQueries({ queryKey: ["ecr-list"] });
        void qc.invalidateQueries({ queryKey: ["ecr-dashboard"] });
        void refetchComments();
      } else {
        setFeedback({ type: "error", msg: res.message || "Failed to execute workflow action." });
      }
    },
    onError: (mutationError) => {
      setFeedback({
        type: "error",
        msg: mutationError instanceof Error ? mutationError.message : "Failed to execute workflow action.",
      });
    },
  });

  async function handleCreateRFQ() {
    if (!ecr?.name) return;
    setRfqLoading(true);
    setFeedback(null);
    const res = await createRFQFromECR(ecr.name);
    if (res.success) {
      setFeedback({
        type: "success",
        msg: res.message || `RFQ ${res.rfqName || ""} created successfully.`.trim(),
      });
      qc.setQueryData<EngineeringChangeRequest | undefined>(["ecr", name], (current) =>
        current
          ? {
              ...current,
              select_pxfp: res.newStatus || "RFQ",
              status: res.newStatus || "RFQ",
              supplier_response_required: "Yes",
              rfq: res.rfqName || current.rfq,
              approval_requirements: res.approvalRequirements ?? current.approval_requirements,
            }
          : current,
      );
      void qc.invalidateQueries({ queryKey: ["ecr", name] });
      void qc.invalidateQueries({ queryKey: ["ecr-list"] });
      void qc.invalidateQueries({ queryKey: ["ecr-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["rfqs"] });
    } else {
      setFeedback({ type: "error", msg: res.message || "Failed to create RFQ." });
    }
    setRfqLoading(false);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
          <span>Loading Engineering Change Request...</span>
        </div>
      </div>
    );
  }

  if (isError || !ecr) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <h2 className="text-sm font-bold text-rose-900">Unable to load Engineering Change Request</h2>
          <p className="text-xs text-rose-600">
            {error instanceof Error ? error.message : "Record not found or network connection failed."}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Retry
            </button>
            <Link
              to="/ecr"
              className="rounded-lg border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Back to ECR List
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentStatus = ecr.select_pxfp || "Draft";
  const userRole = user?.role || "engineer";
  if (!canAccessECRRecord(userRole, ecr, user)) return <AccessDenied />;

  const workspace = isECRRole(userRole) ? ECR_WORKSPACES[userRole] : ECR_WORKSPACES.engineer;
  const businessEcrNumber = formatECRNumber(ecr);
  const hasSupplierReq = isECRSupplierSourcingRequired(ecr);
  const rfqReference = getECRRFQReference(ecr);
  const stage = rfqReference ? "RFQ" : canonicalECRStage(currentStatus);
  const procurementVisible = hasReachedECRApproval(currentStatus);
  const procurementStatus = getECRProcurementStatus(ecr);
  const canCreateRFQ = canCreateECRRFQ(userRole, currentStatus, ecr);
  const canEdit = canEditECR(userRole, currentStatus, ecr, user);
  const procurementFlow = getECRProcurementTraceability(ecr);
  const procurementTraceByLabel = new Map(
    procurementFlow.map((item) => [item.label, item]),
  );
  const requestForQuotationTrace = procurementTraceByLabel.get("RFQ");

  const detailTabs: Array<{ id: DetailTab; label: string; icon: typeof Layers }> = [
    { id: "overview", label: "ECR Information", icon: Layers },
    { id: "parts", label: `Affected Parts (${ecr.affected_parts?.length ?? 0})`, icon: Boxes },
    { id: "impacts", label: "Impact & Supplier", icon: ShieldCheck },
    { id: "documents", label: `Documents (${attachments.length})`, icon: FileCode },
  ];
  if (procurementVisible) {
    detailTabs.push({ id: "procurement", label: "Procurement", icon: Building2 });
  }

  const revisionReason = [...(ecr.approval_requirements ?? [])]
    .reverse()
    .find((row) => row.status === "Sent Back")?.comments;
  const needsRevision = stage === "Draft" && Boolean(revisionReason);

  const roleFocus: Array<{ label: string; value: string }> =
    userRole === "engineering"
      ? [
          { label: "Current Revision", value: ecr.affected_parts?.[0]?.current_revision || "—" },
          { label: "New Revision", value: ecr.affected_parts?.[0]?.new_revision || "—" },
          { label: "Engineering Drawing", value: ecr.engineering_drawing || "Not attached" },
          { label: "CAD", value: ecr["3d_cad_file"] || "Not attached" },
          { label: "Engineering Impact", value: ecr.product_impact ? "Impact identified" : "No impact flagged" },
          { label: "Technical Requirements", value: ecr.engineering_notes || "Not recorded" },
        ]
      : userRole === "procurement" || userRole === "procurement_team"
        ? [
            { label: "Supplier Required", value: hasSupplierReq ? "Yes" : "No" },
            { label: "RFQ", value: hasSupplierReq ? "Required" : "Not Required" },
            { label: "Suggested Supplier", value: ecr.suggested_supplier || "—" },
            { label: "Created RFQ", value: rfqReference || "Not Created" },
          ]
        : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      {/* ── Breadcrumb & Top Bar ── */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-neutral-500">
          <Link to="/ecr" className="hover:text-primary-700 font-medium">
            ECR
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          <span className="font-mono text-neutral-800 font-semibold">{businessEcrNumber}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin text-primary-600" : "text-neutral-400"}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Header Card ── */}
      <header className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-base font-bold text-primary-700 tracking-tight">
              {businessEcrNumber}
            </span>
            <ECRStatusBadge status={stage} />
            <ECRPriorityBadge priority={ecr.priority} />
            <span className="rounded-md border border-neutral-200/80 bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
              {ecr.ecr_type || "Part Change"}
            </span>
          </div>

        </div>

        <h1 className="text-xl font-bold text-neutral-900 leading-snug tracking-tight">
          {ecr.ecr_title || "Untitled Engineering Change"}
        </h1>

        <div className="grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Department
            </span>
            <span className="mt-1 block text-xs font-semibold text-neutral-800">
              {ecr.requesting_department || "—"}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Plant
            </span>
            <span className="mt-1 block text-xs font-semibold text-neutral-800">
              {ecr.plant || "—"}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Program
            </span>
            <span className="mt-1 block text-xs font-semibold text-neutral-800">
              {ecr.program || "—"}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Owner
            </span>
            <span
              className="mt-1 block text-xs font-semibold text-neutral-800 truncate"
              title={ecr.ecr_owner || ecr.owner || "—"}
            >
              {ecr.ecr_owner || ecr.owner || "—"}
            </span>
          </div>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Target Date
            </span>
            <span className="mt-1 block text-xs font-semibold text-neutral-800">
              {formatMediumDisplayDate(ecr.target_implementation_date)}
            </span>
          </div>
        </div>

        {/* Action Feedback Alerts */}
        {feedback && (
          <div
            className={`flex items-center gap-2.5 rounded-lg border p-3 text-xs ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
            )}
            <span className="flex-1">{feedback.msg.replaceAll(ecr.name, businessEcrNumber)}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded p-0.5 hover:bg-black/5"
            >
              ×
            </button>
          </div>
        )}
      </header>

      {/* ── Compact status summary ── */}
      {(() => {
        const statusCard = getECRStatusCardInfo(stage, ecr);
        return (
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm" aria-label="ECR status summary">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Status</dt>
                  <dd className="mt-1 text-xs font-bold text-neutral-900">
                    {statusCard.status}
                  </dd>
                </div>
                <div className="border-t border-neutral-100 pt-2.5 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Action Required</dt>
                  <dd className="mt-1 text-xs font-semibold text-neutral-800">
                    {statusCard.actionValue}
                  </dd>
                </div>
                <div className="border-t border-neutral-100 pt-2.5 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Assigned To</dt>
                  <dd className="mt-1 truncate text-xs font-semibold text-neutral-800" title={statusCard.assignedToValue}>
                    {statusCard.assignedToValue}
                  </dd>
                </div>
            </dl>
          </section>
        );
      })()}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm" aria-labelledby="ecr-workflow-progress-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="ecr-workflow-progress-title" className="text-xs font-bold uppercase tracking-wider text-neutral-600">
            Workflow Progress
          </h2>
          {stage === "Rejected" || stage === "Cancelled" ? (
            <span className="text-[11px] font-semibold text-rose-700">Workflow stopped · {stage}</span>
          ) : null}
        </div>
        <ECRWorkflowStepper status={currentStatus} rfqReference={rfqReference} />
      </section>

      {canEdit && stage === "Draft" ? (
        <section className={`rounded-xl border bg-white p-4 shadow-sm ${needsRevision ? "border-amber-200" : "border-primary-200"}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${needsRevision ? "text-amber-700" : "text-primary-700"}`}>
                {needsRevision ? "Revision Required" : "Your ECR Draft"}
              </p>
              <h2 className="mt-0.5 text-sm font-bold text-neutral-900">
                {needsRevision ? "Update the requested changes before resubmitting" : "Complete and submit this engineering change request"}
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                {revisionReason || "Save any remaining information, then submit the ECR to begin the sequential review workflow."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                to={`/ecr/${encodeURIComponent(businessEcrNumber)}/edit`}
                className="inline-flex items-center rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Edit / Save Draft
              </Link>
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Submit ECR" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {workflowMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {needsRevision ? "Resubmit ECR" : "Submit ECR"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Active Reviewer Decision Section (Role + Stage Based) ── */}
      <ECRApprovalPanel
        key={currentStatus}
        role={userRole}
        status={currentStatus}
        approvalRequirements={ecr.approval_requirements ?? []}
        pending={workflowMutation.isPending}
        error={feedback?.type === "error" ? feedback.msg : null}
        onAction={(action, comment, reviewFields) => {
          setActiveAction(action);
          workflowMutation.mutate({
            action,
            cmt: comment || undefined,
            reviewFields,
          });
        }}
      />

      {canCreateRFQ ? (
        <section className="flex flex-col gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2.5 shadow-xs sm:flex-row sm:items-center sm:justify-between" aria-label="RFQ creation required">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">RFQ CREATION REQUIRED</p>
            <p className="mt-0.5 text-[11px] text-neutral-600">Create and issue an RFQ for this approved ECR.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateRFQ()}
            disabled={rfqLoading}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rfqLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Create RFQ
          </button>
        </section>
      ) : null}

      {/* ── Navigation Tabs ── */}
      <div className="border-b border-neutral-200 bg-white rounded-t-xl px-2 pt-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {detailTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as DetailTab)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-primary-600 text-primary-700 bg-primary-50/40 rounded-t-md"
                    : "border-transparent text-neutral-600 hover:text-neutral-900 hover:border-neutral-300"
                }`}
              >
                <tab.icon className={`h-3.5 w-3.5 ${isActive ? "text-primary-600" : "text-neutral-400"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content Workspace ── */}
      <div className="rounded-b-xl border border-t-0 border-neutral-200 bg-white p-4 shadow-sm">
        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {roleFocus.length > 0 ? (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">{workspace.title} focus</h2>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary-100 bg-primary-50/30 p-3 sm:grid-cols-3">
                  {roleFocus.map((item) => (
                    <div key={item.label} className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase text-neutral-400">{item.label}</span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-neutral-800" title={item.value}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg bg-neutral-50/70 border border-neutral-100 p-3 text-xs">
              <div>
                <span className="text-[10px] uppercase font-semibold text-neutral-400 block">ECR Type</span>
                <span className="font-semibold text-neutral-800">{ecr.ecr_type || "—"}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Requesting Dept</span>
                <span className="font-semibold text-neutral-800">{ecr.requesting_department || "—"}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Plant Floor</span>
                <span className="font-semibold text-neutral-800">{ecr.plant || "—"}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Target Date</span>
                <span className="font-semibold text-neutral-800">{formatMediumDisplayDate(ecr.target_implementation_date)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Change Description
                </h3>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                  {ecr.chnage_description || "No description provided."}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Reason for Change
                </h3>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                  {ecr.reason_for_change || "No reason provided."}
                </div>
              </div>

              {ecr.business_justification && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                    Business Justification
                  </h3>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                    {ecr.business_justification}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">Current State</h3>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap min-h-[60px]">
                    {ecr.current_state || "Baseline state not recorded."}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">Proposed State</h3>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap min-h-[60px]">
                    {ecr.proposed_state || "Target state not recorded."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Affected Parts */}
        {activeTab === "parts" && (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-left text-xs text-neutral-700">
                <thead className="bg-neutral-50 font-semibold uppercase text-[10px] text-neutral-500 border-b border-neutral-200">
                  <tr>
                    <th className="px-3 py-2.5">Item Code</th>
                    <th className="px-3 py-2.5">Description</th>
                    <th className="px-2.5 py-2.5 text-center">Curr Rev</th>
                    <th className="px-2.5 py-2.5 text-center">New Rev</th>
                    <th className="px-2.5 py-2.5 text-center">Qty / UOM</th>
                    <th className="px-3 py-2.5">Supplier (Current)</th>
                    <th className="px-3 py-2.5">Supplier (Proposed)</th>
                    <th className="px-3 py-2.5">Change Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(ecr.affected_parts ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-neutral-400">
                        No affected parts listed.
                      </td>
                    </tr>
                  ) : (
                    ecr.affected_parts!.map((part, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50/60">
                        <td className="px-3 py-2" title={part.source_document_reference || undefined}>
                          <span className="block font-mono font-semibold text-primary-700">{part.partitem || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-neutral-800">{part.part_description || "—"}</td>
                        <td className="px-2.5 py-2 text-center font-mono text-neutral-500">{part.current_revision || "—"}</td>
                        <td className="px-2.5 py-2 text-center font-mono font-bold text-emerald-700">{part.new_revision || "—"}</td>
                        <td className="px-2.5 py-2 text-center">{part.quantity ? `${part.quantity} ${part.uom || ""}` : "—"}</td>
                        <td className="px-3 py-2 text-neutral-600">{part.current_supplier || "—"}</td>
                        <td className="px-3 py-2 text-primary-700 font-medium">{part.proposed_supplier || "—"}</td>
                        <td className="px-3 py-2 text-neutral-700">{part.change_required || part.technical_notes || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Impact Assessment */}
        {activeTab === "impacts" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              {[
                { label: "Product Impact", val: ecr.product_impact },
                { label: "Material Impact", val: ecr.material_impact },
                { label: "Manufacturing Impact", val: ecr.manufacturing_impact },
                { label: "Tooling Impact", val: ecr.tooling_impact },
                { label: "Quality Impact", val: ecr.quality_impact },
                { label: "Cost Impact", val: ecr.cost_impact },
                { label: "Supplier Impact", val: ecr.supplier_impact },
                { label: "Delivery Impact", val: ecr.delivery_impact },
                { label: "Customer Impact", val: ecr.customer_impact },
                { label: "Contract Impact", val: ecr.contract_impact },
              ].map((imp) => (
                <div
                  key={imp.label}
                  className={`flex items-center justify-between rounded-lg border p-3 text-xs ${
                    imp.val
                      ? "border-amber-300 bg-amber-50/60 font-semibold text-amber-900"
                      : "border-neutral-200 bg-neutral-50/50 text-neutral-500"
                  }`}
                >
                  <span>{imp.label}</span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                      imp.val ? "bg-amber-600 text-white" : "bg-neutral-200 text-neutral-500"
                    }`}
                  >
                    {imp.val ? "YES" : "NO"}
                  </span>
                </div>
              ))}
            </div>

            {/* Supplier Requirement Strip */}
            <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-2 text-xs">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                  <span className="font-bold text-sky-900">Supplier Required</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${hasSupplierReq ? "bg-sky-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
                    {hasSupplierReq ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                  <span className="font-bold text-sky-900">RFQ</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${hasSupplierReq ? "bg-sky-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
                    {hasSupplierReq ? "Required" : "Not Required"}
                  </span>
                </div>
              </div>
              {hasSupplierReq && (
                <div className="grid grid-cols-1 gap-2 border-t border-sky-100 pt-2 text-neutral-700 sm:grid-cols-4">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Response Type</span>
                    <span className="font-semibold">{ecr.supplier_response_type || "Quotation"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Supplier</span>
                    <span className="font-semibold">{ecr.suggested_supplier || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Created RFQ</span>
                    <span className="font-mono font-semibold">{rfqReference || "Not Created"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-neutral-400 block">Required Qty</span>
                    <span className="font-semibold">{ecr.required_quantity ? `${ecr.required_quantity} ${ecr.quantity_uom || ""}` : "—"}</span>
                  </div>
                </div>
              )}
              {hasSupplierReq && !procurementVisible ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 pt-2 text-[11px]">
                  <span className="font-medium text-neutral-600">Procurement status</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600">
                    Not Started
                  </span>
                </div>
              ) : null}
            </div>

            {ecr.engineering_notes && (
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-500 mb-1">Additional Impact Notes</h4>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 text-xs text-neutral-800 whitespace-pre-wrap">
                  {ecr.engineering_notes}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Documents */}
        {activeTab === "documents" && (
          <div className="space-y-6">
            {attachmentsQuery.isLoading ? (
              <div className="flex items-center justify-center p-8 text-neutral-400 text-xs">
                <Loader2 className="h-5 w-5 animate-spin mr-2 text-primary-600" />
                Loading attached documents…
              </div>
            ) : (
              <div className="space-y-5">
                {(
                  [
                    {
                      category: "Engineering Drawing" as ECRAttachmentCategory,
                      accept: ".pdf,.dwg,.dxf,image/*",
                      description: "Engineering 2D drawing showing revisions, dimensions, and notes.",
                      icon: FileText,
                    },
                    {
                      category: "3D CAD Model" as ECRAttachmentCategory,
                      accept: ".step,.stp,.iges,.igs,.stl,.zip",
                      description: "3D parametric model or exchange format (STEP, IGES).",
                      icon: Layers,
                    },
                    {
                      category: "Specification Document" as ECRAttachmentCategory,
                      accept: ".pdf,.doc,.docx,.xls,.xlsx",
                      description: "Technical specification, datasheets, or material requirements.",
                      icon: FileCode,
                    },
                    {
                      category: "Supporting Documents" as ECRAttachmentCategory,
                      accept: "*/*",
                      description: "Business justifications, supplier reports, test results, or photos.",
                      icon: Paperclip,
                      isMulti: true,
                    },
                  ]
                ).map(({ category, accept, description, icon: Icon, isMulti }) => {
                  const catAttachments = attachments.filter((a) => a.category === category);

                  return (
                    <div
                      key={category}
                      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg bg-neutral-100 p-1.5 text-neutral-600">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <h2 className="text-xs font-bold text-neutral-900">{category}</h2>
                            <p className="text-[11px] text-neutral-500">{description}</p>
                          </div>
                        </div>

                        {canEdit && (isMulti || catAttachments.length === 0) && (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-xs transition-colors self-start sm:self-center">
                            <UploadCloud className="h-3.5 w-3.5 text-neutral-500" />
                            <span>{catAttachments.length > 0 ? "Add Another" : "Upload File"}</span>
                            <input
                              type="file"
                              className="sr-only"
                              accept={accept}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadAttachmentMutation.mutate({ file, category });
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {catAttachments.length > 0 ? (
                        <div className="space-y-2">
                          {catAttachments.map((att) => (
                            <div
                              key={att.id}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 text-xs hover:border-neutral-300 transition-colors"
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <FileText className="h-4 w-4 text-primary-600 flex-shrink-0 mt-0.5" />
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-neutral-900 truncate" title={att.file_name}>
                                      {att.file_name}
                                    </p>
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                      Uploaded
                                    </span>
                                    <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                                      {att.category}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                                    <span>Uploaded by: <strong className="text-neutral-700">{att.uploaded_by || "Engineer"}</strong></span>
                                    <span>•</span>
                                    <span>{att.uploaded_at ? att.uploaded_at.replace("T", " ").slice(0, 19) : "—"}</span>
                                    {att.formatted_size !== "—" && (
                                      <>
                                        <span>•</span>
                                        <span className="font-mono text-neutral-600">{att.formatted_size}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 self-start sm:self-center flex-shrink-0">
                                <a
                                  href={att.full_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-xs transition-colors"
                                >
                                  <Eye className="h-3 w-3 text-neutral-500" />
                                  View
                                </a>
                                <a
                                  href={att.full_url}
                                  download={att.file_name}
                                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-neutral-50 shadow-xs transition-colors"
                                >
                                  <Download className="h-3 w-3 text-primary-600" />
                                  Download
                                </a>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => deleteAttachmentMutation.mutate(att)}
                                    disabled={deleteAttachmentMutation.isPending}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                                  >
                                    <Trash2 className="h-3 w-3 text-rose-500" />
                                    Remove
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between rounded-lg border border-dashed border-neutral-200 bg-neutral-50/40 p-3 text-xs">
                          <span className="text-neutral-400 italic text-[11px]">Not Uploaded</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Procurement sourcing (visible after engineering approval) */}
        {activeTab === "procurement" && procurementVisible && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-lg border border-primary-100 bg-primary-50/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-neutral-900">Sourcing &amp; Supplier Decisions</h2>
                <p className="mt-0.5 text-[11px] text-neutral-600">
                  Engineering approval is complete. Procurement can create the RFQ directly from this ECR.
                </p>
              </div>
              <span className="self-start rounded-full bg-primary-100 px-2.5 py-1 text-[11px] font-bold text-primary-800 sm:self-center">
                {procurementStatus}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[10px] font-semibold uppercase text-neutral-400">Supplier Required</dt>
                <dd className="mt-0.5 font-bold text-neutral-800">{hasSupplierReq ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-neutral-400">RFQ</dt>
                <dd className="mt-0.5 font-bold text-neutral-800">{hasSupplierReq ? "Required" : "Not Required"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-neutral-400">Suggested Supplier</dt>
                <dd className="mt-0.5 font-semibold text-neutral-800">{ecr.suggested_supplier || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-neutral-400">Created RFQ</dt>
                <dd className="mt-0.5 font-mono font-semibold text-neutral-800">{rfqReference || "Not Created"}</dd>
              </div>
            </dl>

            <ol className="grid grid-cols-1 gap-1.5 rounded-lg border border-neutral-200 bg-white p-2 sm:grid-cols-3" aria-label="ECR procurement workflow">
              {procurementFlow.map((item, index) => (
                <li key={item.label} className="relative min-w-0 rounded-md bg-neutral-50 px-2.5 py-2 pr-6">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-neutral-600">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium text-neutral-500">
                    {item.status}
                  </span>
                  {item.reference ? (
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-neutral-500" title={item.reference}>
                      {item.reference}
                    </span>
                  ) : null}
                  {index < procurementFlow.length - 1 ? (
                    <ChevronRight className="absolute right-1 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-neutral-300 lg:block" />
                  ) : null}
                </li>
              ))}
            </ol>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-neutral-700">Request for Quotation</span>
                <Clock className="h-4 w-4 text-teal-600" />
              </div>
              {requestForQuotationTrace?.reference ? (
                <div className="mt-2">
                  <span className="block font-mono text-xs font-bold text-teal-700">{requestForQuotationTrace.reference}</span>
                  <Link
                    to={`/sourcing/rfq/${encodeURIComponent(requestForQuotationTrace.reference)}`}
                    className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-teal-600 hover:underline"
                  >
                    View RFQ <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <span className="mt-2 block text-[11px] font-medium text-neutral-500">
                  {requestForQuotationTrace?.status || "Required"}
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs" aria-labelledby="ecr-add-update-title">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-neutral-500" />
          <h2 id="ecr-add-update-title" className="text-sm font-bold text-neutral-900">Add Activity Update</h2>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="Write a technical comment or workflow update..."
            className="min-h-9 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={() => {
              if (commentText.trim()) workflowMutation.mutate({ action: "Comment", cmt: commentText });
            }}
            disabled={!commentText.trim() || workflowMutation.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {workflowMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Post Update
          </button>
        </div>
      </section>

      <ECRApprovalHistory status={currentStatus} ecr={ecr} comments={comments} />
    </div>
  );
}
