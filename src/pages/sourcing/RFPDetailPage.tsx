import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Lock, Send, Trash2 } from "lucide-react";

import {
  closeRfp,
  deleteRfp,
  getRfp,
  listRfpResponses,
  publishRfp,
  syncLocalRfpEnrichmentToErp,
  updateRfpInternalNotes,
} from "../../api/rfp";
import {
  deleteRfpEnrichment,
  mergeRfpWithEnrichment,
} from "../../api/rfpStorage";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import RfiCollapsibleSection from "../../components/rfi/RfiCollapsibleSection";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate, formatDateTime, todayIso } from "../../utils/format";
import { ownerTitleFromEmail } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";

export default function RFPDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rfpName = id ? decodeURIComponent(id) : "";
  const user = useAuthStore((s) => s.user);
  const canPublishClose =
    user?.role === "procurement" || user?.role === "admin";

  const rfpQuery = useQuery({
    queryKey: ["rfp", rfpName],
    enabled: !!rfpName,
    queryFn: async () => {
      try {
        return await syncLocalRfpEnrichmentToErp(rfpName);
      } catch {
        return mergeRfpWithEnrichment(await getRfp(rfpName));
      }
    },
  });

  const responsesQuery = useQuery({
    queryKey: ["rfp-responses", rfpName],
    enabled: !!rfpName && rfpQuery.data?.status !== "Draft",
    queryFn: () => listRfpResponses(rfpName),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const [notes, setNotes] = useState<string | null>(null);
  const [open, setOpen] = useState({
    general: true,
    scope: true,
    documents: true,
    suppliers: true,
    responses: true,
    notes: true,
  });
  const notesValue = notes ?? rfpQuery.data?.internal_notes ?? "";

  const publishMut = useMutation({
    mutationFn: () => publishRfp(rfpName),
    onSuccess: () => {
      toast.success("RFP published. Suppliers notified.");
      void queryClient.invalidateQueries({ queryKey: ["rfp", rfpName] });
      void queryClient.invalidateQueries({ queryKey: ["rfp-responses", rfpName] });
      void queryClient.invalidateQueries({ queryKey: ["rfps"] });
      void queryClient.invalidateQueries({ queryKey: ["rfp-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: () => closeRfp(rfpName),
    onSuccess: () => {
      toast.success("RFP closed.");
      void queryClient.invalidateQueries({ queryKey: ["rfp", rfpName] });
      void queryClient.invalidateQueries({ queryKey: ["rfps"] });
      void queryClient.invalidateQueries({ queryKey: ["rfp-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteRfp(rfpName),
    onSuccess: () => {
      deleteRfpEnrichment(rfpName);
      toast.success("Draft RFP deleted.");
      void queryClient.invalidateQueries({ queryKey: ["rfps"] });
      void queryClient.invalidateQueries({ queryKey: ["rfp-stats"] });
      navigate("/sourcing/rfp");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const notesMut = useMutation({
    mutationFn: (value: string) => updateRfpInternalNotes(rfpName, value),
    onSuccess: () => {
      toast.success("Internal notes saved.");
      void queryClient.invalidateQueries({ queryKey: ["rfp", rfpName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validateBeforePublish = (): string | null => {
    const rfp = rfpQuery.data;
    if (!rfp) return "RFP not loaded.";
    if (!rfp.submission_deadline) return "Submission deadline is required.";
    if (rfp.submission_deadline < todayIso()) {
      return "Submission Deadline cannot be in the past.";
    }
    if (!rfp.suppliers.length) return "At least one Supplier is required.";
    if (!rfp.required_documents.length) {
      return "At least one Required Document is required.";
    }
    const ids = rfp.suppliers.map((s) => s.supplier.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      return "Duplicate suppliers are not allowed.";
    }
    return null;
  };

  const durationLabel = useMemo(() => {
    const rfp = rfpQuery.data;
    if (!rfp?.estimated_duration_value || !rfp.estimated_duration_unit) {
      return null;
    }
    return `${rfp.estimated_duration_value} ${rfp.estimated_duration_unit}`;
  }, [rfpQuery.data]);

  if (rfpQuery.isLoading) {
    return (
      <div className="space-y-4">
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  if (rfpQuery.isError || !rfpQuery.data) {
    return (
      <ConnectionError
        title="Could not load RFP"
        error={rfpQuery.error ?? new Error("RFP not found")}
        onRetry={() => rfpQuery.refetch()}
      />
    );
  }

  const rfp = rfpQuery.data;
  const responses = responsesQuery.data ?? [];
  const submittedCount = responses.filter((r) => r.status === "Submitted").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={rfp.name}
        description={rfp.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/sourcing/rfp" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            {rfp.status === "Draft" && (
              <>
                <button
                  type="button"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm("Delete this draft RFP?")) {
                      deleteMut.mutate();
                    }
                  }}
                  className="btn-danger"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
                {canPublishClose ? (
                  <button
                    type="button"
                    disabled={publishMut.isPending}
                    onClick={() => {
                      const err = validateBeforePublish();
                      if (err) {
                        toast.error(err);
                        return;
                      }
                      publishMut.mutate();
                    }}
                    className="btn-primary"
                  >
                    {publishMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Publish RFP
                  </button>
                ) : null}
              </>
            )}
            {(rfp.status === "Published" || rfp.status === "Under Review") &&
              canPublishClose && (
                <button
                  type="button"
                  disabled={closeMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Close this RFP? Suppliers will no longer be able to submit.",
                      )
                    ) {
                      closeMut.mutate();
                    }
                  }}
                  className="btn-secondary"
                >
                  {closeMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Close RFP
                </button>
              )}
          </div>
        }
      />

      {/* Enterprise header strip */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {rfp.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-neutral-900">
              {rfp.title}
            </h1>
          </div>
          <StatusBadge status={rfp.status} size="lg" />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">Submission Deadline</dt>
            <dd className="font-medium">
              {formatDate(rfp.submission_deadline)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Category</dt>
            <dd className="font-medium">{rfp.category || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Department</dt>
            <dd className="font-medium">{rfp.department || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Published By</dt>
            <dd className="font-medium">{ownerTitleFromEmail(rfp.owner)}</dd>
          </div>
        </dl>
      </div>

      <RfiCollapsibleSection
        id="general"
        title="General Information"
        open={open.general}
        onToggle={() => setOpen((p) => ({ ...p, general: !p.general }))}
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-neutral-500">Published On</dt>
            <dd className="font-medium">
              {rfp.published_at ? formatDateTime(rfp.published_at) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Estimated Duration</dt>
            <dd className="font-medium">{durationLabel || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-neutral-500">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-neutral-700">
              {rfp.description || "—"}
            </dd>
          </div>
        </dl>
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="scope"
        title="Scope & Objectives"
        open={open.scope}
        onToggle={() => setOpen((p) => ({ ...p, scope: !p.scope }))}
      >
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Scope of Work
            </p>
            <p className="mt-1 whitespace-pre-wrap text-neutral-700">
              {rfp.scope_of_work || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Business Objective
            </p>
            <p className="mt-1 whitespace-pre-wrap text-neutral-700">
              {rfp.business_objective || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Technical Requirements
            </p>
            <p className="mt-1 whitespace-pre-wrap text-neutral-700">
              {rfp.technical_requirements || "—"}
            </p>
          </div>
        </div>
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="documents"
        title="Required Documents"
        subtitle={`${rfp.required_documents.length} document(s)`}
        open={open.documents}
        onToggle={() => setOpen((p) => ({ ...p, documents: !p.documents }))}
      >
        {rfp.required_documents.length === 0 ? (
          <p className="text-sm text-neutral-500">None requested.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2.5">Document Name</th>
                  <th className="px-3 py-2.5">Mandatory</th>
                  <th className="px-3 py-2.5">Max Size</th>
                  <th className="px-3 py-2.5">Allowed Types</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {rfp.required_documents.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2.5 font-medium text-neutral-900">
                      {d.label || d.doc_type}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">
                      {d.required ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-neutral-600">
                      {d.max_file_size_mb ? `${d.max_file_size_mb} MB` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">
                      {d.allowed_file_types?.length
                        ? d.allowed_file_types.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="suppliers"
        title="Invited Suppliers"
        subtitle={`${rfp.suppliers.length} supplier(s)`}
        open={open.suppliers}
        onToggle={() => setOpen((p) => ({ ...p, suppliers: !p.suppliers }))}
      >
        {rfp.suppliers.length === 0 ? (
          <p className="text-sm text-neutral-500">No suppliers invited.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
            {rfp.suppliers.map((s) => (
              <li key={s.supplier} className="px-3 py-2 text-sm">
                <span className="font-medium text-neutral-900">
                  {s.supplier_name}
                </span>
                <span className="ml-2 font-mono text-xs text-neutral-500">
                  {s.supplier}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RfiCollapsibleSection>

      {rfp.status !== "Draft" && (
        <RfiCollapsibleSection
          id="responses"
          title="Supplier Responses"
          subtitle={`${submittedCount} of ${responses.length} submitted`}
          open={open.responses}
          onToggle={() => setOpen((p) => ({ ...p, responses: !p.responses }))}
        >
          {/* Future: Technical / Commercial Evaluation, Scoring, AI Summary */}
          {responsesQuery.isLoading ? (
            <TableSkeleton rows={3} columns={4} />
          ) : responses.length === 0 ? (
            <p className="text-sm text-neutral-500">No responses yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Documents</th>
                    <th>Response ID</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {responses.map((resp) => {
                    const docCount =
                      typeof resp.documents_count === "number" &&
                      resp.documents_count > 0
                        ? resp.documents_count
                        : resp.documents.filter((d) => d.file?.file_url).length;
                    const isPendingPlaceholder = resp.id.startsWith("pending:");
                    return (
                      <tr key={resp.id}>
                        <td className="font-medium text-neutral-900">
                          {resp.supplier_name}
                        </td>
                        <td>
                          <StatusBadge status={resp.status} />
                        </td>
                        <td>
                          {resp.submitted_at
                            ? formatDateTime(resp.submitted_at)
                            : "—"}
                        </td>
                        <td className="tabular-nums">{docCount}</td>
                        <td className="font-mono text-xs text-neutral-600">
                          {isPendingPlaceholder ? "—" : resp.id}
                        </td>
                        <td className="text-right">
                          {isPendingPlaceholder ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <Link
                              to={`/sourcing/rfp/${encodeURIComponent(rfp.name)}/responses/${encodeURIComponent(resp.id)}`}
                              className="table-link"
                            >
                              Open
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </RfiCollapsibleSection>
      )}

      <RfiCollapsibleSection
        id="notes"
        title="Internal Notes"
        subtitle="Visible only to procurement — never shared with suppliers"
        open={open.notes}
        onToggle={() => setOpen((p) => ({ ...p, notes: !p.notes }))}
      >
        <textarea
          rows={4}
          value={notesValue}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add internal review notes…"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={notesMut.isPending}
            onClick={() => notesMut.mutate(notesValue)}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {notesMut.isPending ? "Saving…" : "Save notes"}
          </button>
        </div>
      </RfiCollapsibleSection>

      {rfp.closed_at ? (
        <p className="text-xs text-neutral-400">
          Closed {formatDateTime(rfp.closed_at)}
        </p>
      ) : null}
    </div>
  );
}
