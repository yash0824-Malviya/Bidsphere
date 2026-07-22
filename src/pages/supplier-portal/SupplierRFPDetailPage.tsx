import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Download,
  Loader2,
  Lock,
  Send,
  Upload,
} from "lucide-react";

import {
  getSupplierRfpAssignment,
  resolvePortalSupplierIdForRfp,
  submitRfpResponse,
  uploadRfpFile,
} from "../../api/rfp";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import StatusBadge from "../../components/StatusBadge";
import RfiCollapsibleSection from "../../components/rfi/RfiCollapsibleSection";
import { TableSkeleton } from "../../components/Skeleton";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import SupplierBreadcrumb from "../../components/supplier-portal/SupplierBreadcrumb";
import RequiredDocumentUploadCard, {
  hasDocumentFile,
} from "../../components/supplier-portal/RequiredDocumentUploadCard";
import type { RfpDocumentUpload, RfpRequiredDocument } from "../../types/rfp";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";

function isAccessDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /not invited|not permitted|permission|access denied/i.test(msg);
}

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toUpperCase() : "";
}

function validateUpload(file: File, doc: RfpRequiredDocument): string | null {
  if (doc.max_file_size_mb && file.size > doc.max_file_size_mb * 1024 * 1024) {
    return `File exceeds maximum size of ${doc.max_file_size_mb} MB.`;
  }
  if (doc.allowed_file_types?.length) {
    const ext = fileExt(file.name);
    const allowed = doc.allowed_file_types.map((t) => t.toUpperCase());
    if (ext && !allowed.includes(ext) && !allowed.includes(ext.replace("JPEG", "JPG"))) {
      return `Allowed file types: ${doc.allowed_file_types.join(", ")}.`;
    }
  }
  return null;
}

export default function SupplierRFPDetailPage() {
  const { id } = useParams<{ id: string }>();
  const rfpName = id ? decodeURIComponent(id) : "";
  const { erpSupplierName, isReady, session } = useSupplierSession();

  const supplierIdQuery = useQuery({
    queryKey: [
      "supplier-portal-rfp-supplier-id",
      erpSupplierName,
      session?.linkedSupplier,
    ],
    enabled: isReady && !!erpSupplierName,
    queryFn: () =>
      resolvePortalSupplierIdForRfp(
        String(session?.linkedSupplier || "").trim() || erpSupplierName,
      ),
    staleTime: 5 * 60_000,
  });

  const resolvedSupplier = supplierIdQuery.data ?? "";

  const assignmentQuery = useQuery({
    queryKey: ["supplier-rfp", rfpName, resolvedSupplier],
    enabled: !!resolvedSupplier && !!rfpName,
    queryFn: () => getSupplierRfpAssignment(rfpName, resolvedSupplier),
    retry: false,
  });

  const rfp = assignmentQuery.data?.rfp;
  const response = assignmentQuery.data?.response;
  const readOnly =
    response?.status === "Submitted" || rfp?.status === "Closed";

  const [proposalDescription, setProposalDescription] = useState("");
  const [documents, setDocuments] = useState<RfpDocumentUpload[]>([]);
  const [comments, setComments] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState({
    general: true,
    scope: true,
    technical: true,
    documents: true,
    response: true,
  });

  useEffect(() => {
    if (!response || hydrated) return;
    setProposalDescription(response.proposal_description ?? "");
    setDocuments(
      (response.documents ?? []).filter((d) => hasDocumentFile(d.file)),
    );
    setComments(response.additional_comments ?? "");
    setHydrated(true);
  }, [response, hydrated]);

  useEffect(() => {
    setHydrated(false);
  }, [rfpName, resolvedSupplier]);

  const durationLabel = useMemo(() => {
    if (!rfp?.estimated_duration_value || !rfp.estimated_duration_unit) {
      return null;
    }
    return `${rfp.estimated_duration_value} ${rfp.estimated_duration_unit}`;
  }, [rfp]);

  const attachmentLinks = useMemo(() => {
    return (documents ?? [])
      .filter((d) => hasDocumentFile(d.file))
      .map((d) => ({
        name: d.file.file_name,
        // Keep relative path here; open via getFullFileUrl at click time.
        url: String(d.file.file_url || "").trim(),
        label: d.doc_type,
      }))
      .filter((d) => d.url);
  }, [documents]);

  const submitMut = useMutation({
    mutationFn: () =>
      submitRfpResponse(rfpName, resolvedSupplier, {
        proposal_description: proposalDescription,
        documents,
        additional_comments: comments,
      }),
    onSuccess: () => {
      toast.success("Proposal submitted successfully.");
      void queryClient.invalidateQueries({
        queryKey: ["supplier-rfp", rfpName],
      });
      // Broad invalidate so My RFPs history refreshes for any supplier id key.
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-rfps"],
      });
      // Procurement Response Tracking (same app session / reopen).
      void queryClient.invalidateQueries({
        queryKey: ["rfp-responses", rfpName],
      });
      void queryClient.invalidateQueries({ queryKey: ["rfp", rfpName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearDocument = (documentId: string) => {
    setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
  };

  const handleDocUpload = async (documentId: string, file: File) => {
    if (!rfp || readOnly) return;
    const req = rfp.required_documents.find((d) => d.id === documentId);
    if (!req) return;
    const validationError = validateUpload(file, req);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    clearDocument(documentId);
    setUploadingDoc(documentId);
    setUploadProgress(8);
    const tick = window.setInterval(() => {
      setUploadProgress((p) => {
        if (p == null || p >= 90) return p;
        return p + 8;
      });
    }, 180);
    try {
      const uploaded = await uploadRfpFile(file, resolvedSupplier, {
        rfpName: rfp.name,
      });
      if (!hasDocumentFile(uploaded)) {
        // eslint-disable-next-line no-console
        console.warn("[RFP:upload] missing file_url after confirm — staying Not Uploaded", {
          documentId,
          uploaded,
        });
        clearDocument(documentId);
        toast.error("Upload did not return a usable file URL. Please try again.");
        return;
      }
      setUploadProgress(100);
      setDocuments((prev) => {
        const rest = prev.filter((d) => d.document_id !== documentId);
        return [
          ...rest,
          {
            document_id: documentId,
            doc_type: req.doc_type,
            file: { ...uploaded },
          },
        ];
      });
      // eslint-disable-next-line no-console
      console.log("[RFP:upload] UI refreshed", {
        success: true,
        documentId: uploaded.file_id,
        fileUrl: uploaded.file_url,
        attachmentId: uploaded.file_id,
        document_id: documentId,
      });
      toast.success("File uploaded.");
    } catch (e) {
      clearDocument(documentId);
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      window.clearInterval(tick);
      setUploadingDoc(null);
      setUploadProgress(null);
    }
  };

  const downloadAll = () => {
    if (!attachmentLinks.length) return;
    for (const a of attachmentLinks) {
      if (!a.url) continue;
      const openUrl = a.url.startsWith("data:")
        ? a.url
        : getFullFileUrl(a.url);
      if (!openUrl) continue;
      window.open(openUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <SupplierBreadcrumb
        items={[
          { label: "Dashboard", to: "/supplier/dashboard" },
          { label: "RFPs", to: "/supplier/rfps" },
          { label: rfpName || "RFP Detail" },
        ]}
      />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
            RFP Proposal
          </h1>
          <p className="mt-1 text-[13px] text-[#64748B]">
            Review the request and submit your proposal response.
          </p>
        </div>
        <Link
          to="/supplier/rfps"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My RFPs
        </Link>
      </header>

      <div className="space-y-5 pb-2">
        {!isReady || supplierIdQuery.isLoading || assignmentQuery.isLoading ? (
          <TableSkeleton rows={6} columns={2} />
        ) : assignmentQuery.isError && isAccessDenied(assignmentQuery.error) ? (
          <div className="space-y-4">
            <SupplierAccessDenied
              title="Access denied"
              description="You are not invited to this RFP. Only suppliers listed on the RFP invitation can open it."
            />
            <div className="text-center">
              <Link
                to="/supplier/rfps"
                className="text-sm font-medium text-primary-700 hover:underline"
              >
                Back to My RFPs
              </Link>
            </div>
          </div>
        ) : assignmentQuery.isError || !rfp || !response ? (
          <ConnectionError
            title="Could not load RFP"
            error={assignmentQuery.error ?? new Error("RFP not found")}
            onRetry={() => assignmentQuery.refetch()}
          />
        ) : (
          <>
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
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={rfp.status} size="lg" />
                  <StatusBadge status={response.status} />
                </div>
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
                  <dt className="text-xs text-neutral-500">Est. Duration</dt>
                  <dd className="font-medium">{durationLabel || "—"}</dd>
                </div>
              </dl>
              {readOnly && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  {response.status === "Submitted"
                    ? "Your proposal has been submitted and can no longer be edited."
                    : "This RFP is closed. Proposals are no longer accepted."}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadAll}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <Download className="h-4 w-4" />
                Download Attachments
              </button>
              {!readOnly ? (
                <a
                  href="#rfp-upload-proposal"
                  className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100"
                >
                  <Upload className="h-4 w-4" />
                  Upload Proposal
                </a>
              ) : null}
            </div>

            <RfiCollapsibleSection
              id="general"
              title="General Information"
              open={open.general}
              onToggle={() => setOpen((p) => ({ ...p, general: !p.general }))}
            >
              <p className="whitespace-pre-wrap text-sm text-neutral-700">
                {rfp.description || "—"}
              </p>
            </RfiCollapsibleSection>

            <RfiCollapsibleSection
              id="scope"
              title="Scope of Work"
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
              </div>
            </RfiCollapsibleSection>

            <RfiCollapsibleSection
              id="technical"
              title="Technical Requirements"
              open={open.technical}
              onToggle={() =>
                setOpen((p) => ({ ...p, technical: !p.technical }))
              }
            >
              <p className="whitespace-pre-wrap text-sm text-neutral-700">
                {rfp.technical_requirements || "—"}
              </p>
            </RfiCollapsibleSection>

            <div id="rfp-upload-proposal">
              <RfiCollapsibleSection
                id="documents"
                title="Required Documents"
                subtitle="Upload each requested document. Mandatory files are required before submit."
                open={open.documents}
                onToggle={() =>
                  setOpen((p) => ({ ...p, documents: !p.documents }))
                }
              >
                {rfp.required_documents.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No documents requested.
                  </p>
                ) : (
                  <div className="grid auto-rows-fr gap-4 sm:grid-cols-2">
                    {rfp.required_documents.map((doc) => {
                      const uploaded = documents.find(
                        (d) => d.document_id === doc.id,
                      );
                      const available = hasDocumentFile(uploaded?.file)
                        ? uploaded
                        : undefined;
                      const accept = doc.allowed_file_types?.length
                        ? doc.allowed_file_types
                            .map((t) => `.${t.toLowerCase()}`)
                            .join(",")
                        : undefined;
                      return (
                        <RequiredDocumentUploadCard
                          key={doc.id}
                          title={doc.label || doc.doc_type}
                          required={doc.required}
                          file={available?.file}
                          uploading={uploadingDoc === doc.id}
                          uploadProgress={
                            uploadingDoc === doc.id ? uploadProgress : null
                          }
                          readOnly={readOnly}
                          accept={accept}
                          allowedFileTypes={doc.allowed_file_types}
                          maxFileSizeMb={doc.max_file_size_mb}
                          onUpload={(file) => {
                            void handleDocUpload(doc.id, file);
                          }}
                          onRemove={() => clearDocument(doc.id)}
                          onUnavailable={() => clearDocument(doc.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </RfiCollapsibleSection>
            </div>

            <RfiCollapsibleSection
              id="response"
              title="Your Proposal"
              subtitle="Proposal summary and optional comments"
              open={open.response}
              onToggle={() =>
                setOpen((p) => ({ ...p, response: !p.response }))
              }
            >
              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">
                    Proposal Summary <span className="text-danger-500">*</span>
                  </label>
                  <textarea
                    rows={6}
                    disabled={readOnly}
                    value={proposalDescription}
                    onChange={(e) => setProposalDescription(e.target.value)}
                    placeholder="Summarize your proposal…"
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">
                    Additional Comments
                  </label>
                  <textarea
                    rows={3}
                    disabled={readOnly}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Optional comments for procurement…"
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 disabled:bg-neutral-50"
                  />
                </div>
              </div>
            </RfiCollapsibleSection>

            {readOnly && response.status === "Submitted" ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <a
                  href="#rfp-upload-proposal"
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  View Submission
                </a>
                <button
                  type="button"
                  onClick={downloadAll}
                  disabled={!attachmentLinks.length}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40"
                >
                  <Download className="h-4 w-4" />
                  Download Submitted Proposal
                </button>
                <Link
                  to="/supplier/rfps"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
                >
                  Back to My RFPs
                </Link>
              </div>
            ) : null}

            {!readOnly && (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitMut.isPending}
                  onClick={() => {
                    if (!proposalDescription.trim()) {
                      toast.error("Proposal Summary is required.");
                      return;
                    }
                    for (const doc of rfp.required_documents) {
                      if (!doc.required) continue;
                      const uploaded = documents.find(
                        (d) => d.document_id === doc.id,
                      );
                      if (!hasDocumentFile(uploaded?.file)) {
                        toast.error(
                          `Please upload: ${doc.label || doc.doc_type}`,
                        );
                        return;
                      }
                    }
                    if (
                      window.confirm(
                        "Submit your proposal? You will not be able to edit it after submission.",
                      )
                    ) {
                      submitMut.mutate();
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {submitMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Submit Proposal
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
