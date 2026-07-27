import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Lock, Send, Trash2 } from "lucide-react";

import {
  closeRfi,
  deleteRfi,
  getRfi,
  listRfiResponses,
  publishRfi,
  updateRfiInternalNotes,
} from "../../api/rfi";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import QuestionnaireBuilder from "../../components/rfi/QuestionnaireBuilder";
import RfiCollapsibleSection from "../../components/rfi/RfiCollapsibleSection";
import { formatDate, formatDateTime } from "../../utils/format";
import { ownerTitleFromEmail } from "../../config/roles";

export default function RFIDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rfiName = id ? decodeURIComponent(id) : "";

  const [open, setOpen] = useState({
    general: true,
    questions: true,
    documents: true,
    suppliers: true,
    responses: true,
    notes: false,
  });

  const rfiQuery = useQuery({
    queryKey: ["rfi", rfiName],
    enabled: !!rfiName,
    queryFn: () => getRfi(rfiName),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const responsesQuery = useQuery({
    queryKey: ["rfi-responses", rfiName],
    enabled: !!rfiName && rfiQuery.data?.status !== "Draft",
    queryFn: () => listRfiResponses(rfiName),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const [notes, setNotes] = useState<string | null>(null);
  const notesValue = notes ?? rfiQuery.data?.internal_notes ?? "";

  const publishMut = useMutation({
    mutationFn: () => publishRfi(rfiName),
    onSuccess: () => {
      toast.success("RFI published. Suppliers notified.");
      void queryClient.invalidateQueries({ queryKey: ["rfi", rfiName] });
      void queryClient.invalidateQueries({ queryKey: ["rfi-responses", rfiName] });
      void queryClient.invalidateQueries({ queryKey: ["rfis"] });
      void queryClient.invalidateQueries({ queryKey: ["rfi-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: () => closeRfi(rfiName),
    onSuccess: () => {
      toast.success("RFI closed.");
      void queryClient.invalidateQueries({ queryKey: ["rfi", rfiName] });
      void queryClient.invalidateQueries({ queryKey: ["rfis"] });
      void queryClient.invalidateQueries({ queryKey: ["rfi-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteRfi(rfiName),
    onSuccess: () => {
      toast.success("Draft RFI deleted.");
      void queryClient.invalidateQueries({ queryKey: ["rfis"] });
      void queryClient.invalidateQueries({ queryKey: ["rfi-stats"] });
      navigate("/sourcing/rfi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const notesMut = useMutation({
    mutationFn: (value: string) => updateRfiInternalNotes(rfiName, value),
    onSuccess: () => {
      toast.success("Internal notes saved.");
      void queryClient.invalidateQueries({ queryKey: ["rfi", rfiName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rfiQuery.isLoading) {
    return (
      <div className="space-y-4">
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  if (rfiQuery.isError || !rfiQuery.data) {
    return (
      <ConnectionError
        title="Could not load RFI"
        error={rfiQuery.error ?? new Error("RFI not found")}
        onRetry={() => rfiQuery.refetch()}
      />
    );
  }

  const rfi = rfiQuery.data;
  const responses = responsesQuery.data ?? [];
  const submittedCount = responses.filter((r) => r.status === "Submitted").length;
  const publishedBy = ownerTitleFromEmail(rfi.owner);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={rfi.title}
        description="Request for Information"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/sourcing/rfi" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            {rfi.status === "Draft" && (
              <>
                <button
                  type="button"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm("Delete this draft RFI?")) {
                      deleteMut.mutate();
                    }
                  }}
                  className="btn-danger"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
                <button
                  type="button"
                  disabled={publishMut.isPending}
                  onClick={() => {
                    if (!rfi.questions.length) {
                      toast.error("At least one Question is required before publishing.");
                      return;
                    }
                    if (!rfi.suppliers.length) {
                      toast.error(
                        "At least one Supplier is required before publishing.",
                      );
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
                  Publish RFI
                </button>
              </>
            )}
            {(rfi.status === "Published" || rfi.status === "Under Review") && (
              <button
                type="button"
                disabled={closeMut.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Close this RFI? Suppliers will no longer be able to submit.",
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
                Close RFI
              </button>
            )}
          </div>
        }
      />

      {/* Enterprise header */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[12px] font-semibold tracking-wide text-primary-700">
              {rfi.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#0F172A]">
              {rfi.title}
            </h1>
          </div>
          <StatusBadge status={rfi.status} size="lg" />
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Submission Deadline
            </dt>
            <dd className="mt-0.5 font-medium text-neutral-900">
              {formatDate(rfi.submission_deadline)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Category
            </dt>
            <dd className="mt-0.5 font-medium text-neutral-900">{rfi.category}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Department
            </dt>
            <dd className="mt-0.5 font-medium text-neutral-900">
              {rfi.department}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Published By
            </dt>
            <dd className="mt-0.5 font-medium text-neutral-900">
              {rfi.published_at ? publishedBy : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Published On
            </dt>
            <dd className="mt-0.5 font-medium text-neutral-900">
              {rfi.published_at ? formatDateTime(rfi.published_at) : "—"}
            </dd>
          </div>
        </dl>

        {rfi.description ? (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Description
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
              {rfi.description}
            </p>
          </div>
        ) : null}
      </div>

      <RfiCollapsibleSection
        id="questions"
        title="Questions"
        subtitle="Questionnaire sent to invited suppliers."
        open={open.questions}
        onToggle={() => setOpen((s) => ({ ...s, questions: !s.questions }))}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {rfi.questions.length}
          </span>
        }
      >
        <QuestionnaireBuilder
          questions={rfi.questions}
          onChange={() => undefined}
          readOnly
        />
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="documents"
        title="Required Documents"
        subtitle="Documents suppliers must upload with their response."
        open={open.documents}
        onToggle={() => setOpen((s) => ({ ...s, documents: !s.documents }))}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {rfi.required_documents.length}
          </span>
        }
      >
        {rfi.required_documents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
            No required documents.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-[#F8FAFC]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-3 py-2.5">Document Name</th>
                  <th className="px-3 py-2.5">Mandatory</th>
                  <th className="px-3 py-2.5">Max File Size</th>
                  <th className="px-3 py-2.5">Allowed File Types</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {rfi.required_documents.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2.5 font-medium text-neutral-900">
                      {d.label || d.doc_type}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.required ? "Yes" : "Optional"}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">
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
        title="Suppliers"
        subtitle="Invited suppliers on this RFI."
        open={open.suppliers}
        onToggle={() => setOpen((s) => ({ ...s, suppliers: !s.suppliers }))}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {rfi.suppliers.length}
          </span>
        }
      >
        {rfi.suppliers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
            No suppliers invited.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
            {rfi.suppliers.map((s) => (
              <li key={s.supplier} className="px-3 py-2.5 text-sm">
                <span className="font-medium text-neutral-900">
                  {s.supplier_name}
                </span>
                <span className="ml-2 text-xs text-neutral-500">{s.supplier}</span>
              </li>
            ))}
          </ul>
        )}
      </RfiCollapsibleSection>

      {rfi.status !== "Draft" ? (
        <RfiCollapsibleSection
          id="responses"
          title="Supplier Responses"
          subtitle={`${submittedCount} of ${responses.length} submitted`}
          open={open.responses}
          onToggle={() => setOpen((s) => ({ ...s, responses: !s.responses }))}
        >
          {responsesQuery.isLoading ? (
            <TableSkeleton rows={3} columns={4} />
          ) : responses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
              No responses yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Documents</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {responses.map((resp) => (
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
                      <td className="tabular-nums">{resp.documents.length}</td>
                      <td className="text-right">
                        <Link
                          to={`/sourcing/rfi/${encodeURIComponent(rfi.name)}/responses/${encodeURIComponent(resp.id)}`}
                          className="table-link"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </RfiCollapsibleSection>
      ) : null}

      <RfiCollapsibleSection
        id="notes"
        title="Internal Notes"
        subtitle="Visible only to procurement — never shared with suppliers."
        open={open.notes}
        onToggle={() => setOpen((s) => ({ ...s, notes: !s.notes }))}
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

      {rfi.closed_at ? (
        <p className="text-xs text-neutral-400">
          Closed {formatDateTime(rfi.closed_at)}
        </p>
      ) : null}
    </div>
  );
}
