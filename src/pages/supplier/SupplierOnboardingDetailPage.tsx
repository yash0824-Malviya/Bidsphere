import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";
import PageHeader from "../../components/PageHeader";
import {
  approveOnboardingStage,
  generateSupplierAccount,
  getOnboardingDetail,
  rejectOnboarding,
  requestOnboardingChanges,
} from "../../api/supplierOnboarding";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { useAuthStore } from "../../store/authStore";
import { queryClient } from "../../queryClient";
import { getOnboardingSteps } from "../../config/supplierOnboardingForm";
import OnboardingDiscussionPanel from "../../components/supplier-onboarding/OnboardingDiscussionPanel";
import { ONB } from "../../components/supplier-onboarding/enterprise/onboardingUi";

const DOCUMENT_NOT_FOUND = "Document not found.";

/** Resolve stored ERPNext file_url and verify the file is reachable via the proxy. */
async function resolveAccessibleDocumentUrl(
  fileUrl?: string | null,
): Promise<string | null> {
  const raw = String(fileUrl ?? "").trim();
  if (!raw) return null;

  const url = getFullFileUrl(raw);
  if (!url) return null;

  try {
    const head = await fetch(url, { method: "HEAD", credentials: "same-origin" });
    if (head.status === 404 || head.status === 403) return null;
    if (head.ok || head.status === 405) return url;

    // Some proxies reject HEAD — probe with a tiny ranged GET.
    const probe = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      credentials: "same-origin",
    });
    if (probe.status === 404 || probe.status === 403) return null;
    if (probe.ok || probe.status === 206) return url;
    return null;
  } catch {
    return null;
  }
}

function OnboardingDocumentRow({
  documentType,
  fileName,
  fileUrl,
}: {
  documentType?: string;
  fileName?: string;
  fileUrl?: string;
}) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  const label = documentType || "Document";
  const hasUrl = Boolean(String(fileUrl ?? "").trim());

  async function openDocument(mode: "view" | "download") {
    if (!hasUrl) {
      toast.error(DOCUMENT_NOT_FOUND);
      return;
    }
    setBusy(mode);
    try {
      const url = await resolveAccessibleDocumentUrl(fileUrl);
      if (!url) {
        toast.error(DOCUMENT_NOT_FOUND);
        return;
      }

      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || label;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      // PDF / images open in a new tab; other types download or open via the browser.
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        // Popup blocked — fall back to same-tab-safe navigation via temporary anchor.
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-3 text-sm text-slate-700 shadow-sm">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{label}</p>
        {fileName ? (
          <p className="truncate text-xs text-slate-500">{fileName}</p>
        ) : null}
        {!hasUrl ? (
          <p className="mt-0.5 text-xs text-rose-600">{DOCUMENT_NOT_FOUND}</p>
        ) : (
          <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
            Uploaded
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={!hasUrl || busy !== null}
          onClick={() => void openDocument("view")}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "view" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          View
        </button>
        <button
          type="button"
          disabled={!hasUrl || busy !== null}
          onClick={() => void openDocument("download")}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download
        </button>
      </div>
    </li>
  );
}

export default function SupplierOnboardingDetailPage() {
  const { id = "" } = useParams();
  const name = decodeURIComponent(id);
  const user = useAuthStore((s) => s.user);
  const actor = user?.email || user?.full_name || "Procurement";

  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState("");
  const [changeSections, setChangeSections] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<{
    username: string;
    temporary_password: string;
    login_url: string;
    set_password_link?: string;
  } | null>(null);

  const detailQuery = useQuery({
    queryKey: ["onboarding-detail", name],
    queryFn: () => getOnboardingDetail(name),
    enabled: !!name,
  });

  const record = detailQuery.data?.record;
  const formFields = detailQuery.data?.form_data_fields ?? {};
  const steps = useMemo(() => {
    if (!record) return [];
    return (
      detailQuery.data?.steps ??
      getOnboardingSteps(
        String(record.supplier_type || "Direct"),
        String(record.supplier_category || ""),
      )
    );
  }, [record, detailQuery.data?.steps]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["onboarding-detail", name] });
    await queryClient.invalidateQueries({ queryKey: ["onboarding-list"] });
    await queryClient.invalidateQueries({ queryKey: ["onboarding-stats"] });
  }

  async function onApprove() {
    setBusy(true);
    try {
      const result = await approveOnboardingStage({
        name,
        actor,
        comments,
        origin: window.location.origin,
      });
      if (result.finalized) {
        toast.success(
          `Approved. Supplier ${result.supplier_name || ""} created. Portal modules unlocked.`,
        );
      } else {
        toast.success("Stage approved");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    setBusy(true);
    try {
      await rejectOnboarding({ name, actor, comments });
      toast.success("Onboarding rejected");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onRequestChanges() {
    if (changeSections.length === 0) {
      toast.error("Select at least one section for changes.");
      return;
    }
    setBusy(true);
    try {
      await requestOnboardingChanges({
        name,
        sections: changeSections,
        comments,
        actor,
      });
      toast.success("Changes requested");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request changes failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateAccount() {
    setBusy(true);
    try {
      const created = await generateSupplierAccount({
        name,
        actor,
        origin: window.location.origin,
      });
      setCredentials({
        username: created.username,
        temporary_password: created.temporary_password,
        login_url: created.login_url,
        set_password_link: created.set_password_link,
      });
      toast.success("Supplier portal account generated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate account.");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!record) {
    return (
      <div className="p-8 text-sm text-rose-600">
        Onboarding not found.{" "}
        <Link to="/suppliers/onboarding" className="underline">
          Back to list
        </Link>
      </div>
    );
  }

  const canReview = ["Under Review", "Submitted"].includes(String(record.status));
  const canGenerateAccount = ["Draft", "Link Generated", "Expired"].includes(
    String(record.status),
  );
  const displayStatus =
    record.status === "Link Generated" || record.status === "Opened"
      ? "Onboarding Pending"
      : record.status;

  const statusCards = [
    {
      label: "Pending",
      active: ["Link Generated", "Opened", "In Progress", "Draft"].includes(
        String(record.status),
      ),
      tone: "bg-slate-50 text-slate-700 border-slate-200",
    },
    {
      label: "Submitted",
      active: ["Submitted", "Under Review"].includes(String(record.status)),
      tone: "bg-sky-50 text-sky-800 border-sky-200",
    },
    {
      label: "Approved",
      active: record.status === "Approved",
      tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      label: "Rejected",
      active: record.status === "Rejected" || record.status === "Changes Requested",
      tone: "bg-rose-50 text-rose-700 border-rose-200",
    },
  ];

  const timelineEvents = (record.timeline ?? []).slice().reverse();

  return (
    <div className="space-y-5" style={{ backgroundColor: ONB.bg }}>
      <PageHeader
        actions={
          <Link
            to="/suppliers/onboarding"
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statusCards.map((c) => (
          <div
            key={c.label}
            className={`rounded-2xl border px-4 py-3 shadow-sm transition ${
              c.active
                ? `${c.tone} shadow-md`
                : "border-slate-100 bg-white text-slate-400"
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">
              Status
            </p>
            <p className="mt-1 text-lg font-bold">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Procurement Review
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {record.company_name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {record.name} · {record.supplier_type} · {record.supplier_category}
            </p>
          </div>
          <span
            className="rounded-full px-3 py-1 text-sm font-semibold text-white"
            style={{ backgroundColor: ONB.primary }}
          >
            {displayStatus}
          </span>
        </div>
        {record.linked_supplier && (
          <p className="mt-3 text-sm text-emerald-700">
            Supplier Master:{" "}
            <Link
              to={`/suppliers/${encodeURIComponent(String(record.linked_supplier))}`}
              className="underline"
            >
              {record.linked_supplier}
            </Link>
          </p>
        )}
        {record.portal_user && (
          <p className="mt-2 text-sm text-slate-600">Portal user: {record.portal_user}</p>
        )}
        {record.set_password_link && (
          <p className="mt-2 break-all text-sm text-slate-600">
            Supplier login: {record.set_password_link}
          </p>
        )}
        {credentials && (
          <div className="mt-3 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-semibold text-emerald-900">Portal credentials</p>
            <p>
              Login URL: <span className="break-all">{credentials.login_url}</span>
            </p>
            <p>Username: {credentials.username}</p>
            <p>Temporary password: {credentials.temporary_password}</p>
            {credentials.set_password_link &&
              credentials.set_password_link !== credentials.login_url && (
                <p className="break-all">
                  Set password link: {credentials.set_password_link}
                </p>
              )}
            <button
              type="button"
              className="rounded bg-emerald-700 px-2 py-1 text-xs text-white"
              onClick={async () => {
                const text = [
                  `Login: ${credentials.login_url}`,
                  `Username: ${credentials.username}`,
                  `Temporary Password: ${credentials.temporary_password}`,
                  credentials.set_password_link &&
                  credentials.set_password_link !== credentials.login_url
                    ? `Set Password Link: ${credentials.set_password_link}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n");
                await navigator.clipboard.writeText(text);
                toast.success("Credentials copied");
              }}
            >
              Copy Credentials
            </button>
          </div>
        )}
        {canGenerateAccount && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onGenerateAccount()}
            className="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: ONB.primary }}
          >
            Generate Supplier Account
          </button>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {steps
            .filter((s) => s.id !== "review" && s.id !== "documents")
            .map((step) => (
              <Section key={step.id} title={step.label} icon={<FileText className="h-4 w-4" />}>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {step.fields.map((f) => {
                    const raw =
                      f.storage === "form_data"
                        ? formFields[f.name]
                        : record[f.name];
                    const display =
                      f.kind === "checkbox"
                        ? raw === 1 || raw === true || raw === "1"
                          ? "Yes"
                          : "No"
                        : String(raw ?? "—");
                    return (
                      <div
                        key={f.name}
                        className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                      >
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {f.label}
                        </dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-slate-800">
                          {display || "—"}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </Section>
            ))}

          <Section title="Documents" icon={<FileText className="h-4 w-4" />}>
            {(record.documents?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500">No documents uploaded.</p>
            )}
            <ul className="grid gap-2 sm:grid-cols-2">
              {(record.documents ?? []).map((d, i) => (
                <OnboardingDocumentRow
                  key={`${d.document_type ?? "doc"}-${d.file_url ?? i}-${i}`}
                  documentType={d.document_type}
                  fileName={d.file_name}
                  fileUrl={d.file_url}
                />
              ))}
            </ul>
          </Section>

          <Section title="Messages" icon={<MessageSquare className="h-4 w-4" />}>
            <OnboardingDiscussionPanel
              viewer="procurement"
              name={name}
              actorName={actor}
            />
          </Section>
        </div>

        <div className="space-y-5 xl:sticky xl:top-4 xl:self-start">
          <Section title="Progress" icon={<Clock className="h-4 w-4" />}>
            <div className="space-y-2">
              {(record.approvals?.length
                ? record.approvals
                : detailQuery.data?.approval_stages?.map((s) => ({
                    stage: s.id,
                    stage_order: s.order,
                    status: "Pending",
                  })) ?? []
              ).map((a, i) => {
                const done = String(a.status || "").toLowerCase().includes("approv");
                return (
                  <div
                    key={`${a.stage}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm"
                  >
                    <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-slate-300" />
                      )}
                      {a.stage}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {a.status || "Pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Timeline" icon={<Clock className="h-4 w-4" />}>
            <ol className="relative space-y-0 border-l-2 border-slate-100 pl-4">
              {timelineEvents.length === 0 ? (
                <li className="text-sm text-slate-500">No timeline events yet.</li>
              ) : (
                timelineEvents.map((t, i) => (
                  <li key={`${t.event}-${i}`} className="relative pb-4 last:pb-0">
                    <span
                      className="absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 border-white shadow"
                      style={{ backgroundColor: i === 0 ? ONB.primary : ONB.success }}
                    />
                    <p className="text-sm font-semibold text-slate-800">{t.event}</p>
                    <p className="text-xs text-slate-500">
                      {t.event_on} · {t.actor}
                    </p>
                    {t.notes ? (
                      <p className="mt-0.5 text-xs text-slate-500">{t.notes}</p>
                    ) : null}
                  </li>
                ))
              )}
            </ol>
          </Section>

          {canReview && (
            <Section title="Review Actions" icon={<Check className="h-4 w-4" />}>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                placeholder="Comments (optional)"
                className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold text-slate-600">
                  Request changes for sections
                </p>
                <div className="flex flex-wrap gap-2">
                  {steps
                    .filter((s) => s.id !== "review")
                    .map((s) => {
                      const on = changeSections.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setChangeSections((prev) =>
                              on ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                            )
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            on
                              ? "border-transparent text-white"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          style={on ? { backgroundColor: ONB.primary } : undefined}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onApprove()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: ONB.success }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRequestChanges()}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 disabled:opacity-50"
                >
                  Request Changes
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onReject()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-900">
        {icon ? (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: ONB.primary }}
          >
            {icon}
          </span>
        ) : null}
        {title}
      </h2>
      {children}
    </div>
  );
}
