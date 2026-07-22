import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Lock,
  Save,
  Send,
} from "lucide-react";

import {
  deriveSupplierRfiFacingStatus,
  fetchSupplierCompanySnapshot,
  getSupplierRfiAssignment,
  resolvePortalSupplierId,
  submitRfiResponse,
  uploadRfiFile,
} from "../../api/rfi";
import { queryClient } from "../../queryClient";
import ConnectionError from "../../components/ConnectionError";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import SupplierBreadcrumb from "../../components/supplier-portal/SupplierBreadcrumb";
import RequiredDocumentUploadCard, {
  hasDocumentFile,
} from "../../components/supplier-portal/RequiredDocumentUploadCard";
import QuestionnaireForm from "../../components/rfi/QuestionnaireForm";
import type {
  RfiAnswer,
  RfiDocumentUpload,
  RfiUploadedFile,
} from "../../types/rfi";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";

function onlyAvailableDocuments(docs: RfiDocumentUpload[]): RfiDocumentUpload[] {
  return docs.filter((d) => hasDocumentFile(d.file));
}

function isAccessDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /not invited|not permitted|permission|access denied/i.test(msg);
}

function draftKey(rfiName: string, supplier: string) {
  return `bidsphere:rfi-draft:${rfiName}:${supplier}`;
}

function metaKey(rfiName: string, supplier: string) {
  return `bidsphere:rfi-response-meta:${rfiName}:${supplier}`;
}

function writeResponseMeta(
  rfiName: string,
  supplier: string,
  status: "Draft" | "Submitted",
  extras?: {
    submitted_at?: string;
    submitted_by?: string;
    completion_pct?: number;
  },
) {
  try {
    localStorage.setItem(
      metaKey(rfiName, supplier),
      JSON.stringify({
        status,
        updated_at: new Date().toISOString(),
        ...extras,
      }),
    );
  } catch {
    /* ignore */
  }
}

function daysUntil(deadline: string | undefined): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function deadlineParts(deadline: string | undefined) {
  const days = daysUntil(deadline);
  const date = formatDate(deadline, "d MMM yyyy");
  if (days == null) return { date, due: "—", overdue: false };
  if (days < 0) {
    return {
      date,
      due: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`,
      overdue: true,
    };
  }
  if (days === 0) return { date, due: "Due today", overdue: false };
  return {
    date,
    due: `Due in ${days} Day${days === 1 ? "" : "s"}`,
    overdue: false,
  };
}

function splitDescription(text: string): {
  paragraphs: string[];
  scopeBullets: string[];
} {
  const raw = String(text || "").trim();
  if (!raw) return { paragraphs: [], scopeBullets: [] };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•*]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
  const prose = lines.filter(
    (l) => !/^[-•*]\s+/.test(l) && !/^\d+[.)]\s+/.test(l),
  );
  const paragraphs =
    prose.length > 0
      ? prose
      : raw
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean);
  const scopeBullets = bullets.map((l) =>
    l.replace(/^[-•*]\s+/, "").replace(/^\d+[.)]\s+/, ""),
  );
  return { paragraphs, scopeBullets };
}

function answerComplete(answer: RfiAnswer | undefined, type: string): boolean {
  if (!answer) return false;
  if (type === "checkbox") return (answer.values?.length ?? 0) > 0;
  if (type === "file_upload") return hasDocumentFile(answer.file);
  if (answer.value === null || answer.value === undefined) return false;
  return String(answer.value).trim().length > 0;
}

function SectionCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-4 border-b border-neutral-100 pb-3">
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function SupplierRFIDetailPage() {
  const { id } = useParams<{ id: string }>();
  const rfiName = id ? decodeURIComponent(id) : "";
  const { erpSupplierName, isReady, session } = useSupplierSession();

  const supplierIdQuery = useQuery({
    queryKey: [
      "supplier-portal-rfi-supplier-id",
      erpSupplierName,
      session?.linkedSupplier,
    ],
    enabled: isReady && !!erpSupplierName,
    queryFn: () =>
      resolvePortalSupplierId(
        String(session?.linkedSupplier || "").trim() || erpSupplierName,
      ),
    staleTime: 5 * 60_000,
  });

  const resolvedSupplier = supplierIdQuery.data ?? "";

  const assignmentQuery = useQuery({
    queryKey: ["supplier-rfi", rfiName, resolvedSupplier],
    enabled: !!resolvedSupplier && !!rfiName,
    queryFn: () => getSupplierRfiAssignment(rfiName, resolvedSupplier),
    retry: false,
  });

  const snapshotQuery = useQuery({
    queryKey: ["supplier-rfi-snapshot", resolvedSupplier],
    enabled: !!resolvedSupplier,
    queryFn: () => fetchSupplierCompanySnapshot(resolvedSupplier),
    staleTime: 5 * 60_000,
  });

  const rfi = assignmentQuery.data?.rfi;
  const response = assignmentQuery.data?.response;
  const readOnly =
    response?.status === "Submitted" || rfi?.status === "Closed";

  const [answers, setAnswers] = useState<RfiAnswer[]>([]);
  const [documents, setDocuments] = useState<RfiDocumentUpload[]>([]);
  const [comments, setComments] = useState("");
  const [uploadingQ, setUploadingQ] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);

  useEffect(() => {
    if (!response || !rfiName || !resolvedSupplier || hydrated) return;

    let draft: {
      answers?: RfiAnswer[];
      documents?: RfiDocumentUpload[];
      comments?: string;
    } | null = null;
    try {
      const raw = localStorage.getItem(draftKey(rfiName, resolvedSupplier));
      if (raw) draft = JSON.parse(raw) as typeof draft;
    } catch {
      draft = null;
    }

    if (response.status !== "Submitted" && draft) {
      setAnswers(draft.answers ?? response.answers ?? []);
      setDocuments(
        onlyAvailableDocuments(draft.documents ?? response.documents ?? []),
      );
      setComments(draft.comments ?? response.additional_comments ?? "");
    } else {
      setAnswers(response.answers ?? []);
      setDocuments(onlyAvailableDocuments(response.documents ?? []));
      setComments(response.additional_comments ?? "");
    }
    setHydrated(true);
  }, [response, hydrated, rfiName, resolvedSupplier]);

  useEffect(() => {
    setHydrated(false);
  }, [rfiName, resolvedSupplier]);

  const submitMut = useMutation({
    mutationFn: () =>
      submitRfiResponse(rfiName, resolvedSupplier, {
        answers,
        documents,
        additional_comments: comments,
        company_snapshot: snapshotQuery.data,
      }),
    onSuccess: (submitted) => {
      writeResponseMeta(rfiName, resolvedSupplier, "Submitted", {
        submitted_at: submitted.submitted_at,
        submitted_by: submitted.submitted_by,
        completion_pct: submitted.completion_pct ?? 100,
      });
      try {
        localStorage.removeItem(draftKey(rfiName, resolvedSupplier));
      } catch {
        /* ignore */
      }
      toast.success("Response submitted successfully.");
      void queryClient.invalidateQueries({
        queryKey: ["supplier-rfi", rfiName, resolvedSupplier],
      });
      // Broad invalidate so list + dashboard history refresh for any supplier id key.
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-rfis"],
      });
      // Procurement Response Tracking (same app session / reopen).
      void queryClient.invalidateQueries({
        queryKey: ["rfi-responses", rfiName],
      });
      void queryClient.invalidateQueries({ queryKey: ["rfi", rfiName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleQuestionUpload = async (
    questionId: string,
    file: File,
  ): Promise<RfiUploadedFile> => {
    setUploadingQ(questionId);
    try {
      return await uploadRfiFile(file, resolvedSupplier, { rfiName });
    } finally {
      setUploadingQ(null);
    }
  };

  const clearDocument = (documentId: string) => {
    setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
  };

  const handleDocUpload = async (documentId: string, file: File) => {
    if (!rfi || readOnly) return;
    const req = rfi.required_documents.find((d) => d.id === documentId);
    if (!req) return;

    // Optimistic clear so Replace never leaves a stale View/Download target.
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
      const uploaded = await uploadRfiFile(file, resolvedSupplier, {
        rfiName: rfi.name,
      });
      if (!hasDocumentFile(uploaded)) {
        // eslint-disable-next-line no-console
        console.warn("[RFI:upload] missing file_url after confirm — staying Not Uploaded", {
          documentId,
          uploaded,
        });
        clearDocument(documentId);
        toast.error("Upload did not return a usable file URL. Please try again.");
        return;
      }
      setUploadProgress(100);
      // Refresh card only after backend confirm — enables View/Download/Replace.
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
      console.log("[RFI:upload] UI refreshed", {
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

  const saveDraft = () => {
    if (!rfiName || !resolvedSupplier || readOnly) return;
    try {
      localStorage.setItem(
        draftKey(rfiName, resolvedSupplier),
        JSON.stringify({
          answers,
          documents: onlyAvailableDocuments(documents),
          comments,
          saved_at: new Date().toISOString(),
        }),
      );
      writeResponseMeta(rfiName, resolvedSupplier, "Draft", {
        completion_pct: Math.max(1, progress.percent),
      });
      toast.success("Draft saved.");
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-rfis"],
      });
    } catch {
      toast.error("Could not save draft on this device.");
    }
  };

  const progress = useMemo(() => {
    if (!rfi) {
      return {
        questionsDone: 0,
        questionsTotal: 0,
        docsDone: 0,
        docsTotal: 0,
        missing: [] as string[],
        percent: 0,
      };
    }
    const qs = rfi.questions ?? [];
    const docs = rfi.required_documents ?? [];
    let questionsDone = 0;
    const missing: string[] = [];
    for (const q of qs) {
      const ans = answers.find((a) => a.question_id === q.id);
      const ok = answerComplete(ans, q.type);
      if (ok) questionsDone += 1;
      else if (q.required) missing.push(`Question: ${q.title}`);
    }
    let docsDone = 0;
    for (const d of docs) {
      const up = documents.find((x) => x.document_id === d.id);
      if (hasDocumentFile(up?.file)) docsDone += 1;
      else if (d.required) missing.push(`Document: ${d.label || d.doc_type}`);
    }
    const totalRequired =
      qs.filter((q) => q.required).length +
      docs.filter((d) => d.required).length;
    const doneRequired =
      qs.filter((q) => {
        if (!q.required) return false;
        return answerComplete(
          answers.find((a) => a.question_id === q.id),
          q.type,
        );
      }).length +
      docs.filter((d) => {
        if (!d.required) return false;
        return hasDocumentFile(
          documents.find((x) => x.document_id === d.id)?.file,
        );
      }).length;
    const percent =
      totalRequired > 0
        ? Math.round((doneRequired / totalRequired) * 100)
        : qs.length + docs.length === 0
          ? 100
          : Math.round(
              ((questionsDone + docsDone) /
                Math.max(1, qs.length + docs.length)) *
                100,
            );
    return {
      questionsDone,
      questionsTotal: qs.length,
      docsDone,
      docsTotal: docs.length,
      missing,
      percent,
    };
  }, [rfi, answers, documents]);

  const facingStatus = useMemo(() => {
    if (!rfi || !response) return "Draft";
    return deriveSupplierRfiFacingStatus({
      status: rfi.status,
      response_status: response.status,
      response_locked: response.response_locked || response.status === "Submitted",
      review_status: response.review_status,
      completion_pct: progress.percent,
      submitted_at: response.submitted_at,
      has_local_draft:
        response.status !== "Submitted" &&
        progress.questionsDone + progress.docsDone > 0,
    });
  }, [rfi, response, progress]);

  const statusBadgeClass =
    facingStatus === "In Progress"
      ? "bg-sky-50 text-sky-800 ring-sky-200"
      : facingStatus === "Draft"
        ? "bg-neutral-100 text-neutral-700 ring-neutral-200"
        : facingStatus === "Submitted" || facingStatus === "Approved"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : facingStatus === "Under Review"
            ? "bg-amber-50 text-amber-800 ring-amber-200"
            : facingStatus === "Rejected"
              ? "bg-rose-50 text-rose-700 ring-rose-200"
              : "bg-neutral-100 text-neutral-600 ring-neutral-200";

  const { paragraphs, scopeBullets } = useMemo(
    () => splitDescription(rfi?.description || ""),
    [rfi?.description],
  );

  const dl = deadlineParts(rfi?.submission_deadline);

  return (
    <div className="flex w-full flex-col gap-6">
      <SupplierBreadcrumb
        items={[
          { label: "Dashboard", to: "/supplier/dashboard" },
          { label: "RFIs", to: "/supplier/rfis" },
          { label: rfiName || "RFI Detail" },
        ]}
      />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
            RFI Response
          </h1>
          <p className="mt-1 text-[13px] text-[#64748B]">
            Review the request and submit your information response.
          </p>
        </div>
        <Link
          to="/supplier/rfis"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My RFIs
        </Link>
      </header>

      <div className="space-y-5">
        {!isReady || supplierIdQuery.isLoading || assignmentQuery.isLoading ? (
          <div className="space-y-4">
            <div className="h-28 animate-pulse rounded-xl bg-neutral-100" />
            <div className="h-48 animate-pulse rounded-xl bg-neutral-100" />
            <div className="h-64 animate-pulse rounded-xl bg-neutral-100" />
          </div>
        ) : assignmentQuery.isError && isAccessDenied(assignmentQuery.error) ? (
          <div className="space-y-4">
            <SupplierAccessDenied
              title="Access denied"
              description="You are not invited to this RFI. Only suppliers listed on the RFI invitation can open it."
            />
            <div className="text-center">
              <Link
                to="/supplier/rfis"
                className="text-sm font-medium text-primary-700 hover:underline"
              >
                Back to My RFIs
              </Link>
            </div>
          </div>
        ) : assignmentQuery.isError || !rfi || !response ? (
          <ConnectionError
            title="Could not load RFI"
            error={assignmentQuery.error ?? new Error("RFI not found")}
            onRetry={() => assignmentQuery.refetch()}
          />
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
            <div className="space-y-4">
              {/* 1. Overview */}
              <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {rfi.name}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
                      {rfi.title}
                    </h1>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass}`}
                  >
                    {facingStatus}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Deadline
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-neutral-900">
                      {dl.date}
                    </dd>
                    <dd
                      className={`text-xs font-medium ${
                        dl.overdue ? "text-rose-600" : "text-neutral-500"
                      }`}
                    >
                      {dl.due}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Department
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-neutral-900">
                      {rfi.department || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Buyer
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-neutral-900">
                      {rfi.owner || "Procurement"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Category
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-neutral-900">
                      {rfi.category || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      RFI Number
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-medium text-neutral-900">
                      {rfi.name}
                    </dd>
                  </div>
                </dl>
                {readOnly ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                    {response.status === "Submitted"
                      ? "Your response has been submitted and can no longer be edited."
                      : "This RFI is closed. Responses are no longer accepted."}
                  </div>
                ) : null}
              </section>

              {/* 2. Description */}
              <SectionCard id="description" title="Description">
                {paragraphs.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No description provided.
                  </p>
                ) : (
                  <div className="space-y-3 text-sm leading-relaxed text-neutral-700">
                    {paragraphs.map((p) => (
                      <p key={p.slice(0, 40)}>{p}</p>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* 3. Scope */}
              <SectionCard
                id="scope"
                title="Scope of Requirement"
                subtitle="Key requirements for this information request."
              >
                {scopeBullets.length > 0 ? (
                  <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-700">
                    {scopeBullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : paragraphs.length > 0 ? (
                  <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-700">
                    {paragraphs.slice(0, 6).map((p) => (
                      <li key={p.slice(0, 48)}>
                        {p.length > 180 ? `${p.slice(0, 180)}…` : p}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-neutral-500">
                    Scope details will appear when provided by procurement.
                  </p>
                )}
              </SectionCard>

              {/* 4. Required Documents */}
              <SectionCard
                id="documents"
                title="Required Documents"
                subtitle="Upload each requested document. View and download appear only after a file is available."
              >
                {rfi.required_documents.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No documents requested.
                  </p>
                ) : (
                  <div className="grid auto-rows-fr gap-4 sm:grid-cols-2">
                    {rfi.required_documents.map((doc) => {
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
                          onUpload={(file) => {
                            void handleDocUpload(doc.id, file);
                          }}
                          onUnavailable={() => clearDocument(doc.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* 5. Questionnaire */}
              <SectionCard
                id="questionnaire"
                title="Questionnaire"
                subtitle={`${progress.questionsDone} of ${progress.questionsTotal} questions completed`}
              >
                <QuestionnaireForm
                  questions={rfi.questions}
                  answers={answers}
                  onChange={setAnswers}
                  onUploadFile={readOnly ? undefined : handleQuestionUpload}
                  readOnly={readOnly}
                  uploadingQuestionId={uploadingQ}
                />
              </SectionCard>

              {/* 6. Company Information */}
              <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setCompanyOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 sm:px-6"
                  aria-expanded={companyOpen}
                >
                  <div>
                    <h2 className="text-base font-semibold text-neutral-900">
                      Company Information
                    </h2>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      Auto-filled from your supplier profile
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-neutral-400 transition-transform ${
                      companyOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {companyOpen ? (
                  <div className="border-t border-neutral-100 px-5 py-4 sm:px-6">
                    {snapshotQuery.isLoading ? (
                      <p className="text-sm text-neutral-500">
                        Loading profile…
                      </p>
                    ) : (
                      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <dt className="text-xs text-neutral-500">Company</dt>
                          <dd className="font-medium">
                            {snapshotQuery.data?.supplier_name ||
                              resolvedSupplier}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-500">
                            Supplier ID
                          </dt>
                          <dd>
                            {snapshotQuery.data?.supplier || resolvedSupplier}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-500">Group</dt>
                          <dd>
                            {snapshotQuery.data?.supplier_group || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-500">Country</dt>
                          <dd>{snapshotQuery.data?.country || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-500">Email</dt>
                          <dd>{snapshotQuery.data?.email || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-500">Phone</dt>
                          <dd>{snapshotQuery.data?.mobile_no || "—"}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                ) : null}
              </section>

              {/* 7. Submission Summary */}
              <SectionCard id="summary" title="Submission Summary">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-neutral-100 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Questions Completed
                    </p>
                    <p className="mt-1 text-xl font-semibold text-neutral-900">
                      {progress.questionsDone}
                      <span className="text-sm font-medium text-neutral-400">
                        /{progress.questionsTotal}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-100 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Documents Uploaded
                    </p>
                    <p className="mt-1 text-xl font-semibold text-neutral-900">
                      {progress.docsDone}
                      <span className="text-sm font-medium text-neutral-400">
                        /{progress.docsTotal}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-100 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Progress
                    </p>
                    <p className="mt-1 text-xl font-semibold text-primary-700">
                      {progress.percent}%
                    </p>
                  </div>
                </div>
                {progress.missing.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Missing Items
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                      {progress.missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    All required items are complete.
                  </div>
                )}

                <div className="mt-4">
                  <label className="mb-1.5 block text-sm font-medium text-neutral-800">
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
              </SectionCard>

              {/* Mobile actions */}
              {!readOnly ? (
                <div className="flex flex-wrap gap-2 lg:hidden">
                  <button
                    type="button"
                    onClick={saveDraft}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800"
                  >
                    <Save className="h-4 w-4" />
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={submitMut.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Submit your response? You will not be able to edit it after submission.",
                        )
                      ) {
                        submitMut.mutate();
                      }
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {submitMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Submit Response
                  </button>
                </div>
              ) : null}
            </div>

            {/* 8. Sticky Action Panel */}
            <aside className="hidden lg:block">
              <div className="sticky top-20 space-y-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-600">
                  Action Panel
                </p>
                <div>
                  <p className="text-xs font-medium text-neutral-500">
                    Deadline
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-neutral-900">
                    {dl.date}
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      dl.overdue ? "text-rose-600" : "text-neutral-500"
                    }`}
                  >
                    {dl.due}
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-500">
                      Progress
                    </span>
                    <span className="font-semibold text-primary-700">
                      {progress.percent}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-primary-600 transition-all"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs font-medium text-neutral-500">
                    Required Documents
                  </p>
                  <p className="mt-0.5 font-semibold text-neutral-900">
                    {progress.docsDone} / {progress.docsTotal} uploaded
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs font-medium text-neutral-500">
                    Questionnaire
                  </p>
                  <p className="mt-0.5 font-semibold text-neutral-900">
                    {progress.questionsDone} / {progress.questionsTotal}{" "}
                    completed
                  </p>
                </div>
                {!readOnly ? (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={saveDraft}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      <Save className="h-4 w-4" />
                      Save Draft
                    </button>
                    <button
                      type="button"
                      disabled={submitMut.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Submit your response? You will not be able to edit it after submission.",
                          )
                        ) {
                          submitMut.mutate();
                        }
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {submitMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Submit Response
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    <Lock className="h-3.5 w-3.5" />
                    Response locked
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
