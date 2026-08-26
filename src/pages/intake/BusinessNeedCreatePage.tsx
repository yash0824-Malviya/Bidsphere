import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Save,
  Send,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Clock,
  User,
  AlertTriangle,
} from "lucide-react";

import { useAuthStore } from "../../store/authStore";
import { useLayout } from "../../contexts/LayoutContext";
import {
  createBusinessNeed,
  saveBusinessNeedDraft,
  submitExistingBusinessNeedDraft,
  fetchBusinessNeedById,
} from "../../api/businessIntake";
import { getERPNextCompanies } from "../../api/businessIntakeErp";
import type {
  CreateBusinessNeedInput,
  IntakeAttachment,
} from "../../types/businessIntake";

import { BusinessNeedStepper } from "../../components/intake/stepper/BusinessNeedStepper";
import { Step1Requirement, type Step1Data } from "../../components/intake/stepper/Step1Requirement";
import { Step2Organization, type Step2Data } from "../../components/intake/stepper/Step2Organization";
import { Step3ProjectContext, type Step3Data } from "../../components/intake/stepper/Step3ProjectContext";
import { Step4Budget, type Step4Data } from "../../components/intake/stepper/Step4Budget";
import { Step5Documents } from "../../components/intake/stepper/Step5Documents";
import { Step6ReviewSubmit } from "../../components/intake/stepper/Step6ReviewSubmit";
import { SubmitConfirmationModal } from "../../components/intake/stepper/SubmitConfirmationModal";
import { IntakeSuccessView } from "../../components/intake/stepper/IntakeSuccessView";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";

// ─── Types ───────────────────────────────────────────────────────────────────
type NeedPriority = "Low" | "Medium" | "High" | "Critical";

export default function BusinessNeedCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const editId = routeId || searchParams.get("id") || "";

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [stepErrors, setStepErrors] = useState<Record<number, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Record Identifiers & State
  const [persistedNeedId, setPersistedNeedId] = useState<string>(editId || "");
  const [persistedStatus, setPersistedStatus] = useState<string>("Draft");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Loading States
  const [loadingExisting, setLoadingExisting] = useState<boolean>(Boolean(editId));
  const [savingDraft, setSavingDraft] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);

  // Success State
  const [submittedResult, setSubmittedResult] = useState<{
    businessNeedId: string;
    businessNeedTitle: string;
    businessCaseId?: string;
    workflowStage?: string;
  } | null>(null);

  // Master Data
  const [companies, setCompanies] = useState<
    { name: string; company_name: string; abbr: string; default_currency: string }[]
  >([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  // Form State by Step
  const [step1, setStep1] = useState<Step1Data>({
    title: "",
    problem_statement: "",
    business_justification: "",
    priority: "",
    need_type: "Direct",
    requirement_category: "",
    technical_requirements_list: [],
  });

  const [step2, setStep2] = useState<Step2Data>({
    department: "IT & Digital Transformation",
    company: "Netlink",
    business_unit: "Industrial Operations",
    plant: "Plant 01 - Main Manufacturing Hub",
    requester: user?.full_name || user?.email || "Department User",
    requester_email: user?.email || "department@netlink.com",
    business_owner: user?.full_name || user?.email || "",
    business_owner_email: user?.email || "",
    cost_center: "",
    project: "",
    program: "",
  });

  const [step3, setStep3] = useState<Step3Data>({
    project_name: "",
    project_code: "",
    program_name: "",
    required_by_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    expected_completion_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    business_area: "",
  });

  const [step4, setStep4] = useState<Step4Data>({
    estimated_budget: "",
    currency: "USD",
    budget_type: "CAPEX",
    estimated_quantity: "",
    requirement_type: "",
    funding_source: "",
  });

  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  // Load Companies from ERPNext
  useEffect(() => {
    let isMounted = true;
    setLoadingCompanies(true);
    getERPNextCompanies()
      .then((data) => {
        if (!isMounted) return;
        setCompanies(data);
        if (data.length > 0 && !step2.company) {
          setStep2((prev) => ({ ...prev, company: data[0].name }));
        }
      })
      .catch((err) => {
        console.warn("[BusinessNeedCreate] Could not load ERPNext companies:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingCompanies(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Load Existing Draft if editing
  useEffect(() => {
    if (!editId) return;
    let isMounted = true;
    setLoadingExisting(true);

    fetchBusinessNeedById(editId)
      .then((doc) => {
        if (!isMounted || !doc) return;
        setPersistedNeedId(doc.name || doc.business_need_id);
        setPersistedStatus(doc.status || "Draft");

        setStep1({
          title: doc.title || "",
          problem_statement: doc.problem_statement || doc.description || "",
          business_justification: doc.business_justification || "",
          priority: doc.priority || "High",
          need_type: doc.need_type || "Direct",
          requirement_category: (doc as any).requirement_category || "",
          technical_requirements_list: doc.technical_requirements_list || [],
        });

        setStep2({
          department: doc.department || "IT & Digital Transformation",
          company: doc.company || "Netlink",
          business_unit: doc.business_unit || "Industrial Operations",
          plant: doc.plant || "Plant 01 - Main Manufacturing Hub",
          requester: doc.requester || user?.email || "",
          requester_email: doc.requester_email || user?.email || "",
          business_owner: doc.business_owner || "",
          business_owner_email: doc.business_owner_email || "",
          cost_center: doc.cost_center || "",
          project: doc.project || "",
          program: doc.program || "",
        });

        setStep3({
          project_name: (doc as any).project_name || doc.project || "",
          project_code: (doc as any).project_code || "",
          program_name: (doc as any).program_name || doc.program || "",
          required_by_date: doc.required_by_date || "",
          expected_completion_date: doc.expected_completion_date || "",
          business_area: (doc as any).business_area || "",
        });

        setStep4({
          estimated_budget: doc.estimated_budget || "",
          currency: doc.currency || "USD",
          budget_type: doc.budget_type || "CAPEX",
          estimated_quantity: (doc as any).estimated_quantity || "",
          requirement_type: (doc as any).requirement_type || "",
          funding_source: doc.funding_source || "",
        });

        if (doc.attachments && doc.attachments.length > 0) {
          setAttachments(doc.attachments);
        }
      })
      .catch((err) => {
        console.error("[BusinessNeedCreate] Failed to load draft:", err);
        toast.error("Could not load draft. You can start a new intake form.");
      })
      .finally(() => {
        if (isMounted) setLoadingExisting(false);
      });

    return () => {
      isMounted = false;
    };
  }, [editId]);

  // Validation Logic per step
  const validateStep = (stepId: number): boolean => {
    const errors: Record<string, string> = {};

    if (stepId === 1) {
      if (!step1.title.trim()) errors.title = "Requirement title is required.";
      if (!step1.priority) errors.priority = "Priority is required.";
      if (!step1.problem_statement.trim())
        errors.problem_statement = "Business problem / description is required.";
      if (!step1.business_justification.trim())
        errors.business_justification = "Business justification is required.";
    }

    if (stepId === 2) {
      if (!step2.company.trim()) errors.company = "Company is required.";
      if (!step2.department.trim()) errors.department = "Department is required.";
      if (!step2.plant.trim()) errors.plant = "Plant / location is required.";
      if (!step2.business_owner.trim()) errors.business_owner = "Business Owner is required.";
    }

    if (stepId === 4) {
      if (!step4.estimated_budget || Number(step4.estimated_budget) <= 0) {
        errors.estimated_budget = "A valid estimated budget greater than zero is required.";
      }
    }

    setFieldErrors((prev) => {
      const filtered: Record<string, string> = {};
      Object.keys(prev).forEach((k) => {
        if (
          (stepId === 1 && !["title", "priority", "problem_statement", "business_justification"].includes(k)) ||
          (stepId === 2 && !["company", "department", "plant", "business_owner"].includes(k)) ||
          (stepId === 4 && !["estimated_budget"].includes(k))
        ) {
          filtered[k] = prev[k];
        }
      });
      return { ...filtered, ...errors };
    });

    const hasError = Object.keys(errors).length > 0;
    setStepErrors((prev) => ({ ...prev, [stepId]: hasError }));

    return !hasError;
  };

  const getValidationSummary = (): string[] => {
    const list: string[] = [];
    if (!step1.title.trim()) list.push("Step 1: Requirement Title is required.");
    if (!step1.priority) list.push("Step 1: Priority is required.");
    if (!step1.problem_statement.trim()) list.push("Step 1: Business Problem / Description is required.");
    if (!step1.business_justification.trim()) list.push("Step 1: Business Justification is required.");
    if (!step2.company.trim()) list.push("Step 2: Company is required.");
    if (!step2.department.trim()) list.push("Step 2: Department is required.");
    if (!step2.plant.trim()) list.push("Step 2: Plant / Location is required.");
    if (!step2.business_owner.trim()) list.push("Step 2: Business Owner is required.");
    if (!step4.estimated_budget || Number(step4.estimated_budget) <= 0) {
      list.push("Step 4: Estimated Budget is required and must be greater than zero.");
    }
    return list;
  };

  const isFormCompletelyValid = getValidationSummary().length === 0;

  // Navigation handlers
  const handleStepClick = (targetStep: number) => {
    if (targetStep < currentStep) {
      setCurrentStep(targetStep);
      return;
    }

    const isCurrentValid = validateStep(currentStep);
    if (!isCurrentValid) {
      toast.error("Please complete the required fields in the current step before proceeding.");
      return;
    }

    if (!completedSteps.includes(currentStep)) {
      setCompletedSteps((prev) => [...prev, currentStep]);
    }

    setCurrentStep(targetStep);
  };

  const handleNext = () => {
    const isCurrentValid = validateStep(currentStep);
    if (!isCurrentValid) {
      toast.error("Please fill in all mandatory fields before moving forward.");
      return;
    }

    if (!completedSteps.includes(currentStep)) {
      setCompletedSteps((prev) => [...prev, currentStep]);
    }

    if (currentStep < 6) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  // Compile input payload
  const buildInputPayload = (): CreateBusinessNeedInput => {
    return {
      title: step1.title,
      description: step1.problem_statement,
      problem_statement: step1.problem_statement,
      business_problem: step1.problem_statement,
      business_justification: step1.business_justification,
      priority: (step1.priority as NeedPriority) || "High",
      need_type: step1.need_type,
      requirement_category: step1.requirement_category,
      company: step2.company,
      department: step2.department,
      business_unit: step2.business_unit,
      plant: step2.plant,
      plant_location: step2.plant,
      requester: step2.requester || user?.email || "department@netlink.com",
      requester_email: step2.requester_email || user?.email || "department@netlink.com",
      business_owner: step2.business_owner,
      business_owner_email: step2.business_owner_email || step2.business_owner,
      cost_center: step2.cost_center,
      project: step2.project || step3.project_name || "",
      project_name: step3.project_name,
      project_code: step3.project_code,
      program: step2.program || step3.program_name || "",
      program_name: step3.program_name,
      business_area: step3.business_area,
      required_by_date: step3.required_by_date || undefined,
      expected_completion_date: step3.expected_completion_date || undefined,
      estimated_budget: Number(step4.estimated_budget) || 0,
      currency: step4.currency || "USD",
      budget_type: step4.budget_type || "CAPEX",
      estimated_quantity: Number(step4.estimated_quantity) || undefined,
      requirement_type: step4.requirement_type,
      funding_source: step4.funding_source,
      technical_requirements_list: step1.technical_requirements_list || [],
      attachments: attachments,
    };
  };

  // Save Draft Action
  const handleSaveDraft = async () => {
    if (savingDraft || isSubmitting) return;

    if (!step1.title.trim()) {
      toast.error("Please enter at least a Requirement Title to save a draft.");
      setCurrentStep(1);
      return;
    }

    setSavingDraft(true);
    try {
      const payload = buildInputPayload();
      const userEmail = user?.email || "department@netlink.com";
      const userRole = user?.role || "department";

      const saved = await saveBusinessNeedDraft(
        payload,
        userEmail,
        userRole,
        persistedNeedId || undefined
      );

      const savedId = saved.name || saved.business_need_id;
      setPersistedNeedId(savedId);
      setPersistedStatus(saved.status || "Draft");
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

      toast.success(`Draft saved: ${savedId}`);
      await queryClient.invalidateQueries({ queryKey: ["business-needs"] });
    } catch (err: any) {
      console.error("[BusinessNeedCreate] Save draft failed:", err);
      toast.error(err?.message || "Failed to save draft. Please try again.");
    } finally {
      setSavingDraft(false);
    }
  };

  // Final Submission Action
  const handleFinalSubmit = async () => {
    const summary = getValidationSummary();
    if (summary.length > 0) {
      toast.error("Please resolve all validation errors before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = buildInputPayload();
      const userEmail = user?.email || "department@netlink.com";
      const userRole = user?.role || "department";

      let result;
      if (persistedNeedId) {
        result = await submitExistingBusinessNeedDraft(
          persistedNeedId,
          payload,
          userEmail,
          userRole
        );
      } else {
        result = await createBusinessNeed(
          payload,
          userEmail,
          userRole,
          true
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["business-needs"] });
      await queryClient.invalidateQueries({ queryKey: ["business-cases"] });

      setShowSubmitModal(false);
      setSubmittedResult({
        businessNeedId: result.name || result.business_need_id,
        businessNeedTitle: result.title || step1.title,
        businessCaseId: result.business_case || (result as any).linked_business_case_id,
        workflowStage: "Pending Finance Review",
      });

      toast.success("Business Need submitted! Linked Business Case created.");
    } catch (err: any) {
      console.error("[BusinessNeedCreate] Submission failed:", err);
      toast.error(err?.message || "Business Need submission failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const { sidebarOffset, sidebarMode } = useLayout();

  // Check if form has unsaved changes for safe cancel
  const hasUnsavedChanges = (): boolean => {
    if (step1.title.trim() !== "") return true;
    if (step1.problem_statement.trim() !== "") return true;
    if (step1.business_justification.trim() !== "") return true;
    if (step1.priority !== "") return true;
    if (step1.requirement_category !== "") return true;
    if (step2.cost_center.trim() !== "") return true;
    if (step2.project.trim() !== "") return true;
    if (step2.program.trim() !== "") return true;
    if (step3.project_name.trim() !== "") return true;
    if (step3.project_code.trim() !== "") return true;
    if (step3.program_name.trim() !== "") return true;
    if (step3.business_area.trim() !== "") return true;
    if (step4.estimated_budget !== "") return true;
    if (step4.estimated_quantity !== "") return true;
    if (step4.requirement_type !== "") return true;
    if (step4.funding_source !== "") return true;
    if (attachments.length > 0) return true;
    return false;
  };

  const handleCancel = () => {
    if (hasUnsavedChanges()) {
      setShowDiscardModal(true);
    } else {
      navigate("/intake/business-needs");
    }
  };

  // ─── Success View ────────────────────────────────────────────────────────
  if (submittedResult) {
    return (
      <IntakeSuccessView
        businessNeedId={submittedResult.businessNeedId}
        businessNeedTitle={submittedResult.businessNeedTitle}
        businessCaseId={submittedResult.businessCaseId}
        workflowStage={submittedResult.workflowStage}
      />
    );
  }

  // ─── Loading Existing Draft ──────────────────────────────────────────────
  if (loadingExisting) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary-600" />
        <p className="text-[13px] font-medium text-neutral-500">Loading Business Need draft…</p>
      </div>
    );
  }

  // ─── Footer height token (68–72px enterprise target) ─────────────────────
  const FOOTER_H = 70; // px — used for bottom padding and footer bar

  return (
    <div
      className="business-need-intake-page w-full space-y-5"
      style={{ paddingBottom: FOOTER_H + 36 }}
    >
      {/* ════════════════════════════════════════════════════════════════════
          PAGE HEADER — aligned with form card & breadcrumb
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
        {/* Left: Title + status badges */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-neutral-900 tracking-tight leading-tight">
              Business Need Intake
            </h1>
            <IntakeApprovalBadge status={persistedStatus as any} size="sm" />
            {persistedNeedId && (
              <span className="font-mono text-[11px] font-semibold text-primary-700 bg-primary-50 px-2 py-0.5 rounded border border-primary-200">
                {persistedNeedId}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            Define the requirement, business problem, ownership, timing, budget estimate and supporting documents.
          </p>
        </div>

        {/* Right: Meta badges */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 rounded-[6px] border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 font-medium shadow-sm">
            <User className="h-3.5 w-3.5 text-neutral-400" />
            <span>{step2.requester || "Department User"}</span>
          </div>
          {lastSavedTime && (
            <div className="flex items-center gap-1.5 rounded-[6px] border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700 font-medium">
              <Clock className="h-3.5 w-3.5 text-emerald-500" />
              <span>Saved {lastSavedTime}</span>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STEPPER — enterprise horizontal progress nav
      ════════════════════════════════════════════════════════════════════ */}
      <BusinessNeedStepper
        currentStep={currentStep}
        completedSteps={completedSteps}
        stepErrors={stepErrors}
        onStepClick={handleStepClick}
      />

      {/* ════════════════════════════════════════════════════════════════════
          MAIN WORKSPACE — fluid width form card with 32px standard margin
      ════════════════════════════════════════════════════════════════════ */}
      <div className="w-full overflow-hidden rounded-[12px] border border-neutral-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {currentStep === 1 && (
          <Step1Requirement
            data={step1}
            errors={fieldErrors}
            onChange={(updates) => setStep1((prev) => ({ ...prev, ...updates }))}
          />
        )}

        {currentStep === 2 && (
          <Step2Organization
            data={step2}
            companies={companies}
            loadingCompanies={loadingCompanies}
            errors={fieldErrors}
            onChange={(updates) => setStep2((prev) => ({ ...prev, ...updates }))}
          />
        )}

        {currentStep === 3 && (
          <Step3ProjectContext
            data={step3}
            errors={fieldErrors}
            onChange={(updates) => setStep3((prev) => ({ ...prev, ...updates }))}
          />
        )}

        {currentStep === 4 && (
          <Step4Budget
            data={step4}
            errors={fieldErrors}
            onChange={(updates) => setStep4((prev) => ({ ...prev, ...updates }))}
          />
        )}

        {currentStep === 5 && (
          <Step5Documents
            attachments={attachments}
            onChange={(atts) => setAttachments(atts)}
          />
        )}

        {currentStep === 6 && (
          <Step6ReviewSubmit
            step1={step1}
            step2={step2}
            step3={step3}
            step4={step4}
            attachments={attachments}
            onGoToStep={(stepId) => setCurrentStep(stepId)}
            acknowledged={acknowledged}
            onToggleAcknowledge={setAcknowledged}
            isValid={isFormCompletelyValid}
            validationErrors={getValidationSummary()}
          />
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STICKY FOOTER ACTION BAR — 70px height, 32px padding, right-aligned buttons
      ════════════════════════════════════════════════════════════════════ */}
      <div
        className="fixed bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur-sm shadow-[0_-4px_16px_rgba(0,0,0,0.04)] transition-[left] duration-300"
        style={{
          left: sidebarMode !== "drawer" ? sidebarOffset : 0,
          right: 0,
          height: FOOTER_H,
        }}
      >
        <div className="flex h-full w-full items-center justify-between gap-4 px-6 lg:px-8">
          {/* Left: Draft ID badge if exists */}
          <div className="flex items-center gap-3">
            {persistedNeedId ? (
              <span className="font-mono text-[11.5px] text-neutral-500">
                Draft ID: <strong className="text-neutral-700 font-semibold">{persistedNeedId}</strong>
              </span>
            ) : (
              <span className="text-[12px] text-neutral-400">
                New Business Need
              </span>
            )}
          </div>

          {/* Right: [ Cancel ] [ Back ] [ Save Draft ] [ Next Step → ] in ONE horizontal row with 10–12px gap */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex h-10 items-center justify-center rounded-[6px] border border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
            >
              Cancel
            </button>

            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] border border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            )}

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft || isSubmitting}
              className="inline-flex h-10 items-center gap-1.5 rounded-[6px] border border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 hover:border-neutral-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
            >
              {savingDraft ? (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
              ) : (
                <Save className="h-4 w-4 text-neutral-500" />
              )}
              Save Draft
            </button>

            {currentStep < 6 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] bg-primary-600 px-5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                Next Step
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const summary = getValidationSummary();
                  if (summary.length > 0) {
                    toast.error("Please complete all required fields.");
                    return;
                  }
                  if (!acknowledged) {
                    toast.error("Please acknowledge the confirmation checkbox before submitting.");
                    return;
                  }
                  setShowSubmitModal(true);
                }}
                disabled={isSubmitting || !isFormCompletelyValid || !acknowledged}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] bg-emerald-600 px-5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
              >
                <Send className="h-4 w-4" />
                Submit Business Need
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════════════════════════════ */}
      <SubmitConfirmationModal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onConfirm={handleFinalSubmit}
        isSubmitting={isSubmitting}
        title={step1.title || "Business Requirement"}
      />

      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-[14px] border border-neutral-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-red-50 text-red-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-neutral-900">Discard Business Need?</h3>
              <p className="mt-1.5 text-[13px] text-neutral-500 leading-relaxed">
                Your unsaved changes will be lost.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="inline-flex h-9 items-center justify-center rounded-[6px] border border-neutral-300 px-4 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={() => navigate("/intake/business-needs")}
                className="inline-flex h-9 items-center justify-center rounded-[6px] bg-red-600 px-4 text-[12.5px] font-semibold text-white hover:bg-red-700 transition-colors shadow-sm"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
