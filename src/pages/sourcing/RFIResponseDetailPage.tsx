import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Download, Eye, Loader2 } from "lucide-react";

import {
  getRfi,
  getRfiResponse,
  updateResponseInternalNotes,
} from "../../api/rfi";
import { openErpFileInBrowser } from "../../api/legalDocsStorage";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import QuestionnaireForm from "../../components/rfi/QuestionnaireForm";
import RfiDocumentPreviewModal, {
  type RfiPreviewDocument,
} from "../../components/rfi/RfiDocumentPreviewModal";
import { formatDateTime } from "../../utils/format";

export default function RFIResponseDetailPage() {
  const { id, responseId } = useParams<{ id: string; responseId: string }>();
  const rfiName = id ? decodeURIComponent(id) : "";
  const respId = responseId ? decodeURIComponent(responseId) : "";

  const rfiQuery = useQuery({
    queryKey: ["rfi", rfiName],
    enabled: !!rfiName,
    queryFn: () => getRfi(rfiName),
  });

  const responseQuery = useQuery({
    queryKey: ["rfi-response", respId],
    enabled: !!respId,
    queryFn: () => getRfiResponse(respId),
  });

  const [notes, setNotes] = useState<string | null>(null);
  const notesValue = notes ?? responseQuery.data?.internal_notes ?? "";
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const notesMut = useMutation({
    mutationFn: (value: string) => updateResponseInternalNotes(respId, value),
    onSuccess: () => {
      toast.success("Internal notes saved.");
      void queryClient.invalidateQueries({ queryKey: ["rfi-response", respId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewDocuments: RfiPreviewDocument[] = useMemo(() => {
    const docs = responseQuery.data?.documents ?? [];
    return docs
      .filter((d) => Boolean(d.file?.file_url))
      .map((d) => ({
        id: d.document_id,
        label: d.doc_type,
        fileName: d.file.file_name || "document",
        fileUrl: d.file.file_url,
      }));
  }, [responseQuery.data?.documents]);

  const handleDownload = async (doc: {
    document_id: string;
    file: { file_url: string; file_name: string };
  }) => {
    if (!doc.file?.file_url) {
      toast.error("Download failed: no file URL available.");
      return;
    }
    setDownloadingId(doc.document_id);
    try {
      await openErpFileInBrowser(doc.file.file_url, {
        mode: "download",
        fileName: doc.file.file_name || "document",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloadingId(null);
    }
  };

  const openPreview = (documentId: string) => {
    const idx = previewDocuments.findIndex((d) => d.id === documentId);
    if (idx < 0) {
      toast.error("Preview is not available for this file.");
      return;
    }
    setPreviewIndex(idx);
    setPreviewOpen(true);
  };

  if (rfiQuery.isLoading || responseQuery.isLoading) {
    return <TableSkeleton rows={5} columns={3} />;
  }

  if (rfiQuery.isError || responseQuery.isError || !rfiQuery.data || !responseQuery.data) {
    return (
      <ConnectionError
        title="Could not load response"
        error={rfiQuery.error || responseQuery.error}
        onRetry={() => {
          void rfiQuery.refetch();
          void responseQuery.refetch();
        }}
      />
    );
  }

  const rfi = rfiQuery.data;
  const response = responseQuery.data;
  const snapshot = response.company_snapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Response"
        actions={
          <Link
            to={`/sourcing/rfi/${encodeURIComponent(rfi.name)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to RFI
          </Link>
        }
      />

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-neutral-400">{rfi.name}</p>
            <h1 className="mt-1 text-xl font-semibold text-neutral-900">
              {response.supplier_name}
            </h1>
            <p className="text-sm text-neutral-500">{response.supplier}</p>
          </div>
          <StatusBadge status={response.status} size="lg" />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-neutral-500">Submission date</dt>
            <dd className="font-medium">
              {response.submitted_at
                ? formatDateTime(response.submitted_at)
                : "Not submitted"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">RFI title</dt>
            <dd className="font-medium">{rfi.title}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Documents uploaded</dt>
            <dd className="font-medium tabular-nums">
              {response.documents.length}
            </dd>
          </div>
        </dl>
      </div>

      {/* Company profile snapshot */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">
          Company Information
        </h2>
        {snapshot ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-neutral-500">Company</dt>
              <dd className="font-medium">{snapshot.supplier_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Supplier ID</dt>
              <dd>{snapshot.supplier}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Group</dt>
              <dd>{snapshot.supplier_group || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Country</dt>
              <dd>{snapshot.country || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Email</dt>
              <dd>{snapshot.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Phone</dt>
              <dd>{snapshot.mobile_no || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Website</dt>
              <dd>{snapshot.website || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Tax ID</dt>
              <dd>{snapshot.tax_id || "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-neutral-500">
            Company profile not captured for this response.
          </p>
        )}
      </div>

      {/* Answers */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">
          Questionnaire Answers
        </h2>
        <QuestionnaireForm
          questions={rfi.questions}
          answers={response.answers}
          onChange={() => undefined}
          readOnly
        />
      </div>

      {/* Documents */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">
          Uploaded Documents
        </h2>
        {response.documents.length === 0 ? (
          <p className="text-sm text-neutral-500">No documents uploaded.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
            {response.documents.map((doc) => {
              const hasFile = Boolean(doc.file?.file_url);
              const isDownloading = downloadingId === doc.document_id;
              return (
                <li
                  key={doc.document_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{doc.doc_type}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {doc.file?.file_name || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={!hasFile}
                      onClick={() => openPreview(doc.document_id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    <button
                      type="button"
                      disabled={!hasFile || isDownloading}
                      onClick={() => void handleDownload(doc)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Download
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {response.additional_comments && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-base font-semibold text-neutral-900">
            Additional Comments
          </h2>
          <p className="whitespace-pre-wrap text-sm text-neutral-700">
            {response.additional_comments}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-neutral-900">
          Internal Notes
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Procurement-only notes for this supplier response.
        </p>
        <textarea
          rows={4}
          value={notesValue}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
          placeholder="Add review notes…"
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
      </div>

      <RfiDocumentPreviewModal
        open={previewOpen}
        documents={previewDocuments}
        initialIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
