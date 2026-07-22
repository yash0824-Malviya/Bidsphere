import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";

import {
  getRfp,
  getRfpResponse,
  updateRfpResponseInternalNotes,
} from "../../api/rfp";
import { openErpFileInBrowser } from "../../api/legalDocsStorage";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import RfiDocumentPreviewModal, {
  canOpenDocumentPreview,
  type RfiPreviewDocument,
} from "../../components/rfi/RfiDocumentPreviewModal";
import { formatDate, formatDateTime } from "../../utils/format";
import { formatFileSize } from "../../utils/materialRequestItemFiles";

function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i + 1).toUpperCase() : "FILE";
}

function FileTypeIcon({ fileName }: { fileName: string }) {
  const lower = fileName.toLowerCase();
  if (/\.pdf$/i.test(lower)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
        <FileText className="h-5 w-5" />
      </span>
    );
  }
  if (/\.(png|jpe?g|gif|webp)$/i.test(lower)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-100">
        <FileImage className="h-5 w-5" />
      </span>
    );
  }
  if (/\.(xlsx|xls|csv)$/i.test(lower)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">
        <FileSpreadsheet className="h-5 w-5" />
      </span>
    );
  }
  if (/\.(docx|doc|rtf)$/i.test(lower)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
        <FileText className="h-5 w-5" />
      </span>
    );
  }
  if (/\.(zip|rar|7z)$/i.test(lower) || /\.(dwg|dxf|step|stp)$/i.test(lower)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
        <FileArchive className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-50 text-neutral-600 ring-1 ring-inset ring-neutral-200">
      <FileText className="h-5 w-5" />
    </span>
  );
}

function extensionBadgeClass(ext: string): string {
  const e = ext.toUpperCase();
  if (e === "PDF") return "bg-rose-50 text-rose-700 ring-rose-100";
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(e)) {
    return "bg-sky-50 text-sky-700 ring-sky-100";
  }
  if (["XLS", "XLSX", "CSV"].includes(e)) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }
  if (["DOC", "DOCX", "RTF"].includes(e)) {
    return "bg-blue-50 text-blue-700 ring-blue-100";
  }
  if (["ZIP", "RAR", "7Z", "DWG", "DXF"].includes(e)) {
    return "bg-amber-50 text-amber-800 ring-amber-100";
  }
  return "bg-neutral-50 text-neutral-600 ring-neutral-200";
}

export default function RFPResponseDetailPage() {
  const { id, responseId } = useParams<{ id: string; responseId: string }>();
  const rfpName = id ? decodeURIComponent(id) : "";
  const respId = responseId ? decodeURIComponent(responseId) : "";

  const rfpQuery = useQuery({
    queryKey: ["rfp", rfpName],
    enabled: !!rfpName,
    queryFn: () => getRfp(rfpName),
  });

  const responseQuery = useQuery({
    queryKey: ["rfp-response", respId],
    enabled: !!respId,
    queryFn: () => getRfpResponse(respId),
  });

  const [notes, setNotes] = useState<string | null>(null);
  const notesValue = notes ?? responseQuery.data?.internal_notes ?? "";
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const notesMut = useMutation({
    mutationFn: (value: string) =>
      updateRfpResponseInternalNotes(respId, value),
    onSuccess: () => {
      toast.success("Internal notes saved.");
      void queryClient.invalidateQueries({ queryKey: ["rfp-response", respId] });
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
    const fileName = previewDocuments[idx]?.fileName || "";
    if (!canOpenDocumentPreview(fileName)) {
      toast.error("Preview is not available for this file type.");
      return;
    }
    setPreviewIndex(idx);
    setPreviewOpen(true);
  };

  if (rfpQuery.isLoading || responseQuery.isLoading) {
    return <TableSkeleton rows={5} columns={3} />;
  }

  if (
    rfpQuery.isError ||
    responseQuery.isError ||
    !rfpQuery.data ||
    !responseQuery.data
  ) {
    return (
      <ConnectionError
        title="Could not load response"
        error={rfpQuery.error || responseQuery.error}
        onRetry={() => {
          void rfpQuery.refetch();
          void responseQuery.refetch();
        }}
      />
    );
  }

  const rfp = rfpQuery.data;
  const response = responseQuery.data;
  const uploadedBy = response.supplier_name || response.supplier || "—";
  const uploadedDocs = response.documents.filter((d) => d.file?.file_url);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Proposal"
        actions={
          <Link
            to={`/sourcing/rfp/${encodeURIComponent(rfp.name)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to RFP
          </Link>
        }
      />

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-neutral-400">{rfp.name}</p>
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
            <dt className="text-xs text-neutral-500">RFP title</dt>
            <dd className="font-medium">{rfp.title}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Documents uploaded</dt>
            <dd className="font-medium tabular-nums">
              {typeof response.documents_count === "number" &&
              response.documents_count > 0
                ? response.documents_count
                : uploadedDocs.length}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-neutral-900">
          Proposal Description
        </h2>
        <p className="whitespace-pre-wrap text-sm text-neutral-700">
          {response.proposal_description || "—"}
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Uploaded Documents
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              View or download supplier proposal attachments.
            </p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
            {uploadedDocs.length} file{uploadedDocs.length === 1 ? "" : "s"}
          </span>
        </div>

        {uploadedDocs.length === 0 ? (
          <p className="text-sm text-neutral-500">No documents uploaded.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {uploadedDocs.map((doc) => {
              const fileName = doc.file?.file_name || "document";
              const ext = fileExtension(fileName);
              const canView = canOpenDocumentPreview(fileName);
              const isDownloading = downloadingId === doc.document_id;
              const uploadDate =
                doc.file?.uploaded_at || response.submitted_at || "";
              return (
                <article
                  key={doc.document_id}
                  className="flex h-full flex-col rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <FileTypeIcon fileName={fileName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${extensionBadgeClass(ext)}`}
                        >
                          {ext}
                        </span>
                        <span className="truncate text-[11px] font-medium text-neutral-500">
                          {doc.doc_type}
                        </span>
                      </div>
                      <p
                        className="mt-1 truncate text-sm font-semibold text-neutral-900"
                        title={fileName}
                      >
                        {fileName}
                      </p>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                    <div>
                      <dt className="text-neutral-400">File Size</dt>
                      <dd className="mt-0.5 font-medium text-neutral-700">
                        {typeof doc.file?.file_size === "number"
                          ? formatFileSize(doc.file.file_size)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Upload Date</dt>
                      <dd className="mt-0.5 font-medium text-neutral-700">
                        {uploadDate
                          ? formatDate(uploadDate, "d MMM yyyy")
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Extension</dt>
                      <dd className="mt-0.5 font-medium text-neutral-700">
                        .{ext.toLowerCase()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-400">Uploaded By</dt>
                      <dd
                        className="mt-0.5 truncate font-medium text-neutral-700"
                        title={uploadedBy}
                      >
                        {uploadedBy}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <button
                      type="button"
                      disabled={!canView}
                      title={
                        canView
                          ? "View document"
                          : "Preview not available for this file type"
                      }
                      onClick={() => openPreview(doc.document_id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={() => void handleDownload(doc)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Download
                    </button>
                  </div>
                  {!canView ? (
                    <p className="mt-2 text-[11px] text-neutral-400">
                      Preview not available — download to open this file.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
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
          Procurement-only notes for this supplier proposal.
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
