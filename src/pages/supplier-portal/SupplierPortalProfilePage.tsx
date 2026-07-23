import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  PartyPopper,
  Save,
  Upload,
} from "lucide-react";

import {
  legacyPinGetProfile,
  legacyPinResolveUpload,
  legacyPinSaveProfile,
  listSupplierCategories,
  portalGetProfile,
  portalSaveDraft,
  portalSubmit,
  resolveOnboardingUpload,
  type OnboardingRecord,
  type PortalProfileResponse,
  type SupplierCategoryRow,
} from "../../api/supplierOnboarding";
import { uploadFileToERPNext } from "../../api/legalDocsStorage";
import {
  DOCUMENT_TYPES,
  splitPayload,
  type OnboardingFieldDef,
  type OnboardingStepDef,
} from "../../config/supplierOnboardingForm";
import { isLegacyPinProfileEnabled } from "../../config/legacyPinProfile";
import {
  useSupplierSession,
  writeSupplierSession,
  readSupplierSession,
  clearSupplierSession,
} from "../../hooks/useSupplierSession";
import OnboardingDiscussionPanel from "../../components/supplier-onboarding/OnboardingDiscussionPanel";
import JourneyHeader from "../../components/supplier-onboarding/enterprise/JourneyHeader";
import StepNavSidebar from "../../components/supplier-onboarding/enterprise/StepNavSidebar";
import ProgressSidebar from "../../components/supplier-onboarding/enterprise/ProgressSidebar";
import {
  ONB,
  buildSupplierJourney,
  computeOnboardingProgress,
  fieldGroupsForStep,
  stepDescription,
} from "../../components/supplier-onboarding/enterprise/onboardingUi";

function applyProfileToSession(res: PortalProfileResponse) {
  const current = readSupplierSession();
  if (!current) return;
  writeSupplierSession({
    ...current,
    companyName: res.company_name || current.companyName,
    linkedSupplier: res.linked_supplier || current.linkedSupplier,
    unlocked: current.authMode === "pin" ? true : !!res.unlocked,
    displayStatus: res.display_status || current.displayStatus,
    firstLogin: current.authMode === "pin" ? false : !!res.first_login,
    onboardingName: res.record?.name || current.onboardingName,
    portalUser: res.portal_user || current.portalUser,
  });
}

function isSessionExpiredError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message : String(err || "");
  return status === 401 || /session expired|sign in again/i.test(message);
}

export default function SupplierPortalProfilePage() {
  const navigate = useNavigate();
  const {
    supplierName,
    erpSupplierName,
    sessionToken,
    authMode,
    isReady,
    isAuthenticated,
    displayStatus,
    unlocked,
  } = useSupplierSession();

  // TEMPORARY LEGACY MODE — Remove after all suppliers migrate to Account Login.
  const legacyPinMode =
    isLegacyPinProfileEnabled() && authMode === "pin" && !!erpSupplierName;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [steps, setSteps] = useState<OnboardingStepDef[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [formDataFields, setFormDataFields] = useState<Record<string, unknown>>({});
  const [classificationLocks, setClassificationLocks] = useState<{
    custom_sourcing_type?: boolean;
    custom_supplier_category?: boolean;
  }>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const [editableSteps, setEditableSteps] = useState<string[] | null>(null);
  const [discussionUnread, setDiscussionUnread] = useState(0);
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState<string>(DOCUMENT_TYPES[0]);
  const [uploading, setUploading] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<SupplierCategoryRow[]>([]);
  /** UI-only phase — does not change workflow / API. */
  const [uiPhase, setUiPhase] = useState<"welcome" | "form" | "success">("welcome");
  const [dragOver, setDragOver] = useState(false);

  function handleSessionExpired() {
    clearSupplierSession();
    toast.error("Session expired. Please sign in again.");
    navigate("/supplier/login", { replace: true });
  }

  const load = useCallback(async () => {
    if (!sessionToken && !legacyPinMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // TEMPORARY LEGACY MODE
      const res = legacyPinMode
        ? await legacyPinGetProfile(erpSupplierName)
        : await portalGetProfile(sessionToken);
      applyProfileToSession(res);
      if (res.record) setRecord(res.record as OnboardingRecord);
      if (res.steps) setSteps(res.steps);
      setLocked(legacyPinMode ? false : !!res.locked);
      setEditableSteps(res.editable_steps ?? null);
      setDiscussionUnread(res.discussion?.unread_count || 0);
      const nextValues: Record<string, unknown> = {};
      if (res.record) {
        for (const [k, v] of Object.entries(res.record)) {
          if (typeof v !== "object" || v === null) nextValues[k] = v;
        }
      }
      setValues(nextValues);

      if (legacyPinMode) {
        // TEMPORARY LEGACY MODE — lock only when ERP custom fields are set
        setFormDataFields(res.form_data_fields ?? {});
        setClassificationLocks({
          custom_sourcing_type: !!res.classification_locks?.custom_sourcing_type,
          custom_supplier_category:
            !!res.classification_locks?.custom_supplier_category,
        });
      } else {
        // Seed classification from onboarding record (Procurement) first
        const onboardingType = String(
          (res.record as OnboardingRecord | undefined)?.supplier_type || "",
        ).trim();
        const onboardingCategory = String(
          (res.record as OnboardingRecord | undefined)?.supplier_category || "",
        ).trim();
        const fields = { ...(res.form_data_fields ?? {}) };
        if (onboardingType) fields.custom_sourcing_type = onboardingType;
        if (onboardingCategory) fields.custom_supplier_category = onboardingCategory;
        setFormDataFields(fields);

        // Locked when Procurement set them, or ERP already has them (write-once)
        const apiLocks = res.classification_locks || {};
        setClassificationLocks({
          custom_sourcing_type:
            !!apiLocks.custom_sourcing_type || !!onboardingType,
          custom_supplier_category:
            !!apiLocks.custom_supplier_category || !!onboardingCategory,
        });
      }

      const status = String(res.record?.status || res.display_status || "");
      if (["Submitted", "Under Review", "Approved"].includes(status) && !legacyPinMode) {
        setUiPhase("success");
      } else if (String(res.record?.company_name || "").trim()) {
        setUiPhase("form");
      }
    } catch (err) {
      if (!legacyPinMode && isSessionExpiredError(err)) {
        handleSessionExpired();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not load profile");
    } finally {
      setLoading(false);
    }
  }, [sessionToken, legacyPinMode, erpSupplierName, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Load Supplier Category options from ERPNext (never hardcode)
    void listSupplierCategories()
      .then((rows) => setCategoryOptions(rows || []))
      .catch(() => setCategoryOptions([]));
  }, []);

  const visibleSteps = useMemo(() => {
    if (!editableSteps?.length) return steps;
    const review = steps.filter((s) => s.id === "review");
    return [
      ...steps.filter((s) => editableSteps.includes(s.id) && s.id !== "review"),
      ...review,
    ];
  }, [steps, editableSteps]);

  const current = visibleSteps[stepIndex];
  const isLast = stepIndex >= visibleSteps.length - 1;

  function setField(field: OnboardingFieldDef, value: unknown) {
    if (
      (field.name === "custom_sourcing_type" &&
        classificationLocks.custom_sourcing_type) ||
      (field.name === "custom_supplier_category" &&
        classificationLocks.custom_supplier_category)
    ) {
      return; // Suppliers never modify Procurement-locked classification
    }
    if (field.storage === "form_data") {
      setFormDataFields((prev) => ({ ...prev, [field.name]: value }));
    } else {
      setValues((prev) => ({ ...prev, [field.name]: value }));
    }
  }

  function getFieldValue(field: OnboardingFieldDef): unknown {
    if (field.name === "custom_sourcing_type") {
      return (
        formDataFields.custom_sourcing_type ||
        values.custom_sourcing_type ||
        record?.supplier_type ||
        ""
      );
    }
    if (field.name === "custom_supplier_category") {
      return (
        formDataFields.custom_supplier_category ||
        values.custom_supplier_category ||
        record?.supplier_category ||
        ""
      );
    }
    if (field.storage === "form_data") return formDataFields[field.name];
    return values[field.name];
  }

  function getValueByName(name: string): unknown {
    if (name === "custom_sourcing_type") {
      return (
        formDataFields.custom_sourcing_type ||
        values.custom_sourcing_type ||
        record?.supplier_type ||
        ""
      );
    }
    if (name === "custom_supplier_category") {
      return (
        formDataFields.custom_supplier_category ||
        values.custom_supplier_category ||
        record?.supplier_category ||
        ""
      );
    }
    if (name in formDataFields) return formDataFields[name];
    return values[name];
  }

  function isClassificationFieldLocked(fieldName: string): boolean {
    if (fieldName === "custom_sourcing_type") {
      return !!classificationLocks.custom_sourcing_type;
    }
    if (fieldName === "custom_supplier_category") {
      return !!classificationLocks.custom_supplier_category;
    }
    return false;
  }

  function validateStep(step: OnboardingStepDef): boolean {
    for (const f of step.fields) {
      if (!f.required) continue;
      if (isClassificationFieldLocked(f.name)) continue;
      const v = getFieldValue(f);
      if (v === undefined || v === null || String(v).trim() === "") {
        toast.error(`${f.label} is required`);
        return false;
      }
    }
    return true;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const sourcing = String(
        formDataFields.custom_sourcing_type ??
          values.custom_sourcing_type ??
          record?.supplier_type ??
          "",
      ).trim();
      const category = String(
        formDataFields.custom_supplier_category ??
          values.custom_supplier_category ??
          record?.supplier_category ??
          "",
      ).trim();
      if (!sourcing) {
        toast.error("Supplier Type is required");
        return;
      }
      if (!category) {
        toast.error("Supplier Category is required");
        return;
      }

      const { columns, formDataFields: inferred } = splitPayload(values);
      const nextFormData = {
        ...inferred,
        ...formDataFields,
        custom_sourcing_type: sourcing,
        custom_supplier_category: category,
      };
      // TEMPORARY LEGACY MODE
      if (legacyPinMode) {
        const res = await legacyPinSaveProfile({
          supplier_name: erpSupplierName,
          values: { ...columns, ...nextFormData },
        });
        applyProfileToSession(res);
        if (res.record) setRecord(res.record as OnboardingRecord);
        setFormDataFields({
          ...(res.form_data_fields || {}),
          custom_sourcing_type: String(
            res.form_data_fields?.custom_sourcing_type || sourcing,
          ),
          custom_supplier_category: String(
            res.form_data_fields?.custom_supplier_category || category,
          ),
        });
        setClassificationLocks({
          custom_sourcing_type:
            !!res.classification_locks?.custom_sourcing_type || !!sourcing,
          custom_supplier_category:
            !!res.classification_locks?.custom_supplier_category || !!category,
        });
        toast.success("Profile saved");
        return;
      }
      const res = await portalSaveDraft({
        session_token: sessionToken,
        values: columns,
        form_data_fields: nextFormData,
      });
      applyProfileToSession(res);
      if (res.record) setRecord(res.record);
      setFormDataFields(res.form_data_fields ?? nextFormData);
      setClassificationLocks({
        custom_sourcing_type:
          !!res.classification_locks?.custom_sourcing_type ||
          !!String(res.record?.supplier_type || sourcing).trim(),
        custom_supplier_category:
          !!res.classification_locks?.custom_supplier_category ||
          !!String(res.record?.supplier_category || category).trim(),
      });
      toast.success(res.unchanged ? "No changes to save" : "Draft saved");
    } catch (err) {
      if (!legacyPinMode && isSessionExpiredError(err)) {
        handleSessionExpired();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (legacyPinMode) {
      // TEMPORARY LEGACY MODE — PIN suppliers are already approved in Supplier Master
      toast.success("Profile is already active for your company account.");
      return;
    }
    setSaving(true);
    try {
      const { columns, formDataFields: inferred } = splitPayload(values);
      const res = await portalSubmit({
        session_token: sessionToken,
        values: columns,
        form_data_fields: { ...inferred, ...formDataFields },
      });
      applyProfileToSession(res);
      if (res.record) setRecord(res.record);
      setLocked(true);
      setUiPhase("success");
      toast.success("Submitted for procurement approval");
    } catch (err) {
      if (isSessionExpiredError(err)) {
        handleSessionExpired();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    try {
      // TEMPORARY LEGACY MODE
      const resolved = legacyPinMode
        ? await legacyPinResolveUpload(erpSupplierName)
        : await resolveOnboardingUpload({ session_token: sessionToken });
      const fileUrl = await uploadFileToERPNext(file, resolved.doctype, resolved.docname);
      if (legacyPinMode) {
        toast.success("Document uploaded");
        await load();
        return;
      }
      const res = await portalSaveDraft({
        session_token: sessionToken,
        documents: [{ document_type: docType, file_url: fileUrl, file_name: file.name }],
      });
      applyProfileToSession(res);
      if (res.record) setRecord(res.record);
      toast.success("Document uploaded");
    } catch (err) {
      if (!legacyPinMode && isSessionExpiredError(err)) {
        handleSessionExpired();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const companyDisplay =
    String(values.company_name || record?.company_name || supplierName || "Supplier");

  const progress = useMemo(
    () =>
      computeOnboardingProgress({
        steps: visibleSteps,
        record,
        getValue: getValueByName,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleSteps, record, values, formDataFields],
  );

  const journey = useMemo(
    () =>
      buildSupplierJourney({
        status: record?.status || displayStatus,
        unlocked,
        hasCompany: !!String(values.company_name || record?.company_name || "").trim(),
        hasBusiness: progress.sections.find((s) => s.id === "bank")?.done,
        hasDocs: (record?.documents?.length ?? 0) > 0,
        submitted: ["Submitted", "Under Review", "Approved", "Changes Requested"].includes(
          String(record?.status || ""),
        ),
      }),
    [record, displayStatus, unlocked, values.company_name, progress.sections],
  );

  const navSteps = useMemo(() => {
    const list = [
      { id: "welcome", label: "Welcome", formIndex: -1 },
      ...visibleSteps.map((s, i) => ({
        id: s.id,
        label: s.id === "review" ? "Review" : s.label,
        formIndex: i,
      })),
    ];
    if (!list.some((s) => s.id === "review")) {
      list.push({ id: "submission", label: "Submission", formIndex: -2 });
    }
    return list;
  }, [visibleSteps]);

  const completedIds = useMemo(() => {
    const set = new Set<string>();
    if (uiPhase !== "welcome") set.add("welcome");
    for (const s of visibleSteps) {
      if (s.id === "documents" && (record?.documents?.length ?? 0) > 0) {
        set.add(s.id);
        continue;
      }
      if (s.id === "review") {
        if (["Submitted", "Under Review", "Approved"].includes(String(record?.status))) {
          set.add(s.id);
        }
        continue;
      }
      const req = s.fields.filter((f) => f.required);
      if (
        req.length > 0 &&
        req.every((f) => {
          const v = getFieldValue(f);
          return v !== undefined && v !== null && String(v).trim() !== "";
        })
      ) {
        set.add(s.id);
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSteps, record, values, formDataFields, uiPhase]);

  const activeNavId =
    uiPhase === "welcome"
      ? "welcome"
      : uiPhase === "success"
        ? "review"
        : current?.id || "company";

  if (!isReady || !isAuthenticated) return null;

  // TEMPORARY LEGACY MODE — hide account-only restriction when flag is on for PIN users
  if (!sessionToken && !legacyPinMode) {
    return (
      <>
        <div className="p-8 text-sm text-slate-600">
          Profile onboarding is available for account-based portal users. Your company PIN
          session does not include an onboarding draft.
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="min-h-[calc(100vh-4rem)]"
        style={{ backgroundColor: ONB.bg }}
      >
        {loading ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: ONB.primary }} />
            <p className="text-sm font-medium">Loading your onboarding workspace…</p>
            <div className="mt-4 grid w-full gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-40 animate-pulse rounded-xl bg-white shadow-sm"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-6">
            <JourneyHeader items={journey} />

            <div className="grid items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)_300px] xl:grid-cols-[240px_minmax(0,1fr)_320px]">
              <div className="lg:sticky lg:top-4 lg:self-start">
                <StepNavSidebar
                  companyName={companyDisplay}
                  statusBadge={displayStatus || record?.status}
                  steps={navSteps}
                  activeId={activeNavId}
                  completedIds={completedIds}
                  onSelect={(id, formIndex) => {
                    if (id === "welcome") {
                      setUiPhase("welcome");
                      return;
                    }
                    if (formIndex >= 0) {
                      setUiPhase("form");
                      setStepIndex(formIndex);
                    }
                  }}
                />
              </div>

              <main className="min-w-0 space-y-3 pb-24">
                {uiPhase === "welcome" && (
                  <WelcomeCard
                    companyName={companyDisplay}
                    onStart={() => {
                      setUiPhase("form");
                      setStepIndex(0);
                    }}
                  />
                )}

                {uiPhase === "success" && (
                  <SuccessCard
                    companyName={companyDisplay}
                    status={String(record?.status || "Waiting for Procurement Review")}
                    onContinue={() => {
                      setUiPhase("form");
                      const reviewIdx = visibleSteps.findIndex((s) => s.id === "review");
                      setStepIndex(reviewIdx >= 0 ? reviewIdx : 0);
                    }}
                  />
                )}

                {uiPhase === "form" && (
                  <>
                    {locked && (
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          Waiting for Procurement approval. Fields are read-only
                          {record?.status === "Changes Requested"
                            ? " except requested sections."
                            : "."}
                        </p>
                      </div>
                    )}

                    <div
                      key={current?.id || stepIndex}
                      className="space-y-3 duration-300 ease-out animate-[onbFadeIn_0.28s_ease-out]"
                    >
                      <header className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5">
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: ONB.primary }}
                        >
                          Step {(stepIndex + 1).toString().padStart(2, "0")} of{" "}
                          {visibleSteps.length.toString().padStart(2, "0")}
                        </p>
                        <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                          {current?.label}
                        </h2>
                        <p className="mt-1 max-w-3xl text-sm text-slate-500">
                          {stepDescription(current?.id || "")}
                        </p>
                      </header>

                      {current?.id === "documents" && (
                        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                          <DocumentsStep
                            docType={docType}
                            setDocType={setDocType}
                            locked={locked}
                            uploading={uploading}
                            dragOver={dragOver}
                            setDragOver={setDragOver}
                            documents={record?.documents ?? []}
                            onUpload={onUpload}
                          />
                        </section>
                      )}

                      {current &&
                        current.id !== "documents" &&
                        current.id !== "review" &&
                        fieldGroupsForStep(current.id, current.fields).map((group) => {
                          const groupFields = group.names
                            .map((n) => current.fields.find((f) => f.name === n))
                            .filter((f): f is OnboardingFieldDef => !!f);
                          if (!groupFields.length) return null;
                          return (
                            <section
                              key={group.title}
                              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                            >
                              <div className="mb-3.5 flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                <h3 className="text-sm font-semibold text-slate-900">
                                  {group.title}
                                </h3>
                              </div>
                              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2 xl:grid-cols-3">
                                {groupFields.map((field) => {
                                  const classificationLocked =
                                    isClassificationFieldLocked(field.name);
                                  const spanFull =
                                    field.kind === "textarea" || field.kind === "checkbox";
                                  return (
                                    <div
                                      key={field.name}
                                      className={spanFull ? "md:col-span-2 xl:col-span-3" : undefined}
                                    >
                                      <FieldInput
                                        field={field}
                                        value={getFieldValue(field)}
                                        disabled={
                                          classificationLocked ||
                                          (locked && !legacyPinMode)
                                        }
                                        readOnlyDisplay={classificationLocked}
                                        categoryOptions={categoryOptions}
                                        onChange={(v) => setField(field, v)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}

                      {current?.id === "review" && (
                        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                          <ReviewStep
                            company={String(values.company_name || record?.company_name || "—")}
                            contact={String(values.contact_person || record?.contact_person || "—")}
                            docCount={record?.documents?.length ?? 0}
                            status={String(record?.status || "Draft")}
                            sections={progress.sections}
                            unread={discussionUnread}
                          />
                        </section>
                      )}
                    </div>

                    <OnboardingDiscussionPanel
                      viewer="supplier"
                      sessionToken={legacyPinMode ? undefined : sessionToken}
                      legacySupplierName={legacyPinMode ? erpSupplierName : undefined}
                      actorName={String(
                        record?.contact_person ||
                          record?.company_name ||
                          supplierName ||
                          "Supplier",
                      )}
                      onUnreadChange={setDiscussionUnread}
                    />

                    {/* Sticky bottom action bar */}
                    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-6px_24px_rgba(15,23,42,0.08)] backdrop-blur-md lg:left-[260px]">
                      <div className="page-container flex flex-wrap items-center gap-2 !py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                        <button
                          type="button"
                          disabled={stepIndex === 0}
                          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Previous
                        </button>
                        {(!locked || legacyPinMode || !!erpSupplierName) && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void saveDraft()}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-[#146CE8]/40 hover:bg-slate-50"
                          >
                            {saving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            Save Draft
                          </button>
                        )}
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          {!isLast && (
                            <button
                              type="button"
                              onClick={() => {
                                if (current && !locked && !validateStep(current)) return;
                                setStepIndex((i) => i + 1);
                              }}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
                              style={{ backgroundColor: ONB.primary }}
                            >
                              Next
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          )}
                          {isLast && !locked && !legacyPinMode && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void submit()}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
                              style={{ backgroundColor: ONB.success }}
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              Submit for Approval
                            </button>
                          )}
                        </div>
                        {legacyPinMode && (
                          <p className="w-full text-xs text-slate-500">
                            Company PIN profile is loaded from Supplier Master. Changes save
                            directly to your supplier record.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </main>

              <div className="lg:sticky lg:top-4 lg:self-start">
                <ProgressSidebar
                  overall={progress.overall}
                  sections={progress.sections}
                  pendingTasks={
                    discussionUnread > 0
                      ? [
                          "Reply Procurement Comment",
                          ...progress.pendingTasks,
                        ]
                      : progress.pendingTasks
                  }
                  estimatedMinutes={progress.estimatedMinutes}
                  unreadMessages={discussionUnread}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function WelcomeCard({
  companyName,
  onStart,
}: {
  companyName: string;
  onStart: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div
        className="relative px-6 py-10 sm:px-10 sm:py-14"
        style={{
          background:
            "linear-gradient(135deg, #0B3D91 0%, #146CE8 55%, #3B82F6 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-20">
          <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/30 blur-2xl" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-primary-200/40 blur-2xl" />
        </div>
        <div className="relative max-w-xl text-white">
          <p className="text-sm font-medium text-blue-100">Welcome</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {companyName}
          </h1>
          <p className="mt-3 text-base text-blue-50/95">
            Welcome to BidSphere Supplier Portal.
            <br />
            Complete your supplier onboarding.
          </p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-blue-100/90">
            Estimated Time · 10 Minutes
          </p>
          <button
            type="button"
            onClick={onStart}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold shadow-lg transition hover:bg-blue-50"
            style={{ color: ONB.primary }}
          >
            Start Onboarding
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function SuccessCard({
  companyName,
  status,
  onContinue,
}: {
  companyName: string;
  status: string;
  onContinue: () => void;
}) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm sm:p-12">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 shadow-inner">
        <PartyPopper className="h-10 w-10 animate-pulse" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Congratulations</h2>
      <p className="mt-2 text-sm text-slate-600 sm:text-base">
        Supplier Onboarding Submitted Successfully
      </p>
      <p className="mt-1 text-sm font-medium text-slate-500">{companyName}</p>
      <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-100 bg-slate-50 p-5 text-left">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Status
        </p>
        <p className="mt-1 text-sm font-semibold text-amber-800">
          {status === "Submitted" || status === "Under Review"
            ? "Waiting for Procurement Review"
            : status}
        </p>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Estimated Review Time
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-800">2 Business Days</p>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="mt-6 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        View Submission Summary
      </button>
    </section>
  );
}

function ReviewStep({
  company,
  contact,
  docCount,
  status,
  sections,
  unread,
}: {
  company: string;
  contact: string;
  docCount: number;
  status: string;
  sections: { id: string; label: string; done: boolean; pct: number }[];
  unread: number;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 transition hover:border-slate-200 hover:bg-white hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">{s.label}</p>
              {s.done ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                  Completed
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                  {s.pct}%
                </span>
              )}
            </div>
            {s.id === "documents" ? (
              <p className="mt-2 text-xs text-slate-500">{docCount} uploaded</p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-700">
        <p>
          <span className="font-semibold text-slate-900">Company:</span> {company}
        </p>
        <p className="mt-1">
          <span className="font-semibold text-slate-900">Contact:</span> {contact}
        </p>
        <p className="mt-1">
          <span className="font-semibold text-slate-900">Status:</span> {status}
        </p>
        <p className="mt-1">
          <span className="font-semibold text-slate-900">Comments:</span>{" "}
          {unread > 0 ? `${unread} pending` : "None pending"}
        </p>
      </div>
    </div>
  );
}

function DocumentsStep({
  docType,
  setDocType,
  locked,
  uploading,
  dragOver,
  setDragOver,
  documents,
  onUpload,
}: {
  docType: string;
  setDocType: (v: string) => void;
  locked: boolean;
  uploading: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  documents: Array<{
    document_type?: string;
    file_name?: string;
    file_url?: string;
  }>;
  onUpload: (file: File) => Promise<void>;
}) {
  const uploadedTypes = new Set(
    documents.map((d) => String(d.document_type || "").toLowerCase()),
  );

  return (
    <div className="space-y-5">
      {!locked && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void onUpload(f);
          }}
          className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragOver
              ? "border-blue-400 bg-blue-50"
              : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
          }`}
        >
          <Upload
            className="mx-auto h-8 w-8"
            style={{ color: ONB.primary }}
          />
          <p className="mt-3 text-sm font-semibold text-slate-800">
            Drag & drop a file here
          </p>
          <p className="mt-1 text-xs text-slate-500">or select a document type and browse</p>
          <div className="mx-auto mt-4 flex max-w-md flex-wrap items-end justify-center gap-3">
            <label className="text-left text-xs font-semibold text-slate-600">
              Document type
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="mt-1 block w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: ONB.primary }}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {DOCUMENT_TYPES.map((type) => {
          const match = documents.find(
            (d) =>
              String(d.document_type || "").toLowerCase() === type.toLowerCase() ||
              String(d.document_type || "")
                .toLowerCase()
                .includes(type.toLowerCase().split(" ")[0]),
          );
          const uploaded = !!match || uploadedTypes.has(type.toLowerCase());
          return (
            <div
              key={type}
              className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="rounded-lg bg-slate-50 p-2.5 text-slate-500">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{type}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {match?.file_name || match?.file_url || "Not uploaded"}
                </p>
                <span
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    uploaded
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {uploaded ? "✔ Uploaded" : "Pending"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FIELD_CONTROL =
  "mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#146CE8] focus:outline-none focus:ring-2 focus:ring-[#146CE8]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const FIELD_TEXTAREA =
  "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#146CE8] focus:outline-none focus:ring-2 focus:ring-[#146CE8]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

function FieldInput({
  field,
  value,
  onChange,
  disabled,
  readOnlyDisplay,
  categoryOptions = [],
}: {
  field: OnboardingFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  /** When true, render plain read-only text (no dropdown). */
  readOnlyDisplay?: boolean;
  categoryOptions?: SupplierCategoryRow[];
}) {
  if (readOnlyDisplay) {
    let display = String(value ?? "").trim() || "—";
    if (field.optionsSource === "supplier_category" && display !== "—") {
      display =
        categoryOptions.find((c) => c.name === display)?.category_name ||
        categoryOptions.find((c) => c.category_name === display)?.category_name ||
        display;
    }
    return (
      <div className="block">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">{field.label}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            <Lock className="h-2.5 w-2.5" aria-hidden />
            Read-only
          </span>
        </div>
        <div className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-700">
          <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{display}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Assigned by Procurement — cannot be modified.
        </p>
      </div>
    );
  }

  if (field.kind === "checkbox") {
    return (
      <label className="flex min-h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={value === 1 || value === true || value === "1"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
          className="h-4 w-4 rounded border-slate-300"
          style={{ accentColor: ONB.primary }}
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === "textarea") {
    return (
      <label className="block text-xs font-semibold text-slate-600">
        {field.label}
        {field.required ? " *" : ""}
        <textarea
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={FIELD_TEXTAREA}
        />
      </label>
    );
  }
  if (field.kind === "select") {
    const options =
      field.optionsSource === "supplier_category"
        ? categoryOptions.map((c) => c.name || c.category_name).filter(Boolean)
        : field.options || [];
    return (
      <label className="block text-xs font-semibold text-slate-600">
        {field.label}
        {field.required ? " *" : ""}
        <select
          value={String(value ?? "")}
          disabled={disabled}
          required={!!field.required}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_CONTROL}
        >
          <option value="">Select</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {field.optionsSource === "supplier_category"
                ? categoryOptions.find((c) => c.name === o)?.category_name || o
                : o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {field.label}
      {field.required ? " *" : ""}
      <input
        type={
          field.kind === "email"
            ? "email"
            : field.kind === "tel"
              ? "tel"
              : field.kind === "url"
                ? "url"
                : field.kind === "number"
                  ? "number"
                  : "text"
        }
        value={String(value ?? "")}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CONTROL}
      />
    </label>
  );
}

export function SupplierModuleLockedPage({ title }: { title: string }) {
  useSupplierSession();
  return (
    <>
      <div
        className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center"
        style={{ backgroundColor: ONB.bg }}
      >
        <div className="mb-4 rounded-full bg-slate-100 p-5 text-slate-500 shadow-inner">
          <Lock className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{title} locked</h1>
        <p className="mt-2 text-sm text-slate-600">
          This module unlocks after Procurement approves your onboarding profile.
        </p>
      </div>
    </>
  );
}
