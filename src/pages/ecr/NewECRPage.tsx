import { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  Save,
  Send,
  FileUp,
  Check,
  X,
} from "lucide-react";

import {
  createECR,
  extractECRErrorMessage,
  fetchECR,
  generateECRCreateIdempotencyKey,
  getECRPostSaveWorkflowAction,
  submitECR,
  updateECR,
  type CreateECRPayload,
  type ECRSaveResult,
} from "../../api/ecr";
import { validateECRMasterReferences } from "../../api/ecrMasterData";
import {
  fetchECRProcurementSourceItems,
  fetchECRSupplierRFQs,
  validateECRProcurementSelection,
  type ECRProcurementSourceItem,
} from "../../api/ecrProcurementReferences";
import {
  uploadECRAttachment,
  inferCategoryFromFieldName,
  fetchECRAttachments,
} from "../../api/ecrAttachments";
import { useAuthStore } from "../../store/authStore";
import type {
  ECRAffectedPart,
  ECRProcurementReferenceType,
  ECRType,
} from "../../types/erpnext";
import { canCreateECR, canEditECR, canonicalECRStage, formatECRNumber } from "../../config/ecrRoles";
import { formatERPNextDate } from "../../utils/erpNextDate";
import {
  canonicalizeECRProcurementSelectionInput,
} from "../../utils/ecrProcurementValidation";
import { getECRProcurementTraceability } from "../../components/ecr/ecrDetailModel";
import {
  parseECREngineeringNotes,
  serializeECREngineeringNotes,
} from "../../utils/ecrEngineeringNotes";
import AccessDenied from "../../components/AccessDenied";
import ECRMasterDataPicker from "../../components/ecr/ECRMasterDataPicker";
import ECRProcurementDocumentPicker from "../../components/ecr/ECRProcurementDocumentPicker";

const FIELD_CONTAINER = "flex flex-col gap-1.5";
const LABEL = "text-[13px] font-semibold text-neutral-700";
const INPUT =
  "h-[42px] w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500";
const SELECT =
  "h-[42px] w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100";
const TEXTAREA =
  "min-h-[104px] w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm leading-5 text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100";

const SECTION_CARD = "scroll-mt-28 space-y-5 rounded-lg border border-neutral-200 bg-white p-5 sm:p-[22px]";
const SECTION_HEADER = "flex items-start justify-between gap-4 border-b border-neutral-100 pb-3";
const SECTION_TITLE = "text-base font-semibold text-neutral-900";
const SECTION_DESC = "mt-0.5 text-[13px] leading-5 text-neutral-500";
const ERROR = "text-[11px] font-medium text-rose-600";

const ECR_TYPE_OPTIONS: ECRType[] = [
  "Part Change",
  "Design Change",
  "Material Change",
  "Process Change",
  "Tooling Change",
  "Supplier Change",
  "Quality Change",
  "Packaging Change",
  "Cost Change",
  "Other",
  "Regulatory",
  "Cost Reduction",
  "Quality Issue",
];

const STEP_TITLES = [
  "Basic Information",
  "Change Details",
  "Affected Parts",
  "Impact Assessment",
  "Supplier Impact",
  "Documents",
  "Approval",
  "Procurement",
] as const;

const STEP_IDS = [
  "basic-information",
  "change-details",
  "affected-parts",
  "impact-assessment",
  "supplier-impact",
  "documents",
  "approval",
  "procurement",
] as const;

type DocumentField =
  | "engineering_drawing"
  | "3d_cad_file"
  | "specification"
  | "supporting_documents"
  | "validation_documents";

type ImpactField =
  | "product_impact"
  | "material_impact"
  | "manufacturing_impact"
  | "tooling_impact"
  | "quality_impact"
  | "cost_impact"
  | "supplier_impact"
  | "delivery_impact"
  | "customer_impact"
  | "contract_impact";

const emptyPart = (): Partial<ECRAffectedPart> => ({
  partitem: "",
  part_description: "",
  current_revision: "",
  new_revision: "",
  quantity: 1,
  uom: "Nos",
  change_required: "",
  technical_notes: "",
});

function SectionHeading({
  number,
  title,
  description,
  aside,
}: {
  number: number;
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className={SECTION_HEADER}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-primary-200 bg-primary-50 text-xs font-bold text-primary-700">
          {number}
        </span>
        <div className="min-w-0">
          <h2 className={SECTION_TITLE}>{title}</h2>
          <p className={SECTION_DESC}>{description}</p>
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        {aside}
        <span className="rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-500">
          Step {number} of {STEP_TITLES.length}
        </span>
      </div>
    </div>
  );
}

function fileNameFromUrl(value: string): string {
  if (!value) return "";
  const clean = value.split("?")[0];
  return decodeURIComponent(clean.slice(clean.lastIndexOf("/") + 1));
}

function DocumentUpload({
  id,
  label,
  accept,
  savedValue,
  pendingFile,
  isUploading,
  onSelect,
  onRemove,
}: {
  id: string;
  label: string;
  accept?: string;
  savedValue: string;
  pendingFile?: File;
  isUploading: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const fileName = pendingFile?.name || fileNameFromUrl(savedValue);
  const fileType = pendingFile?.type || fileName.split(".").pop()?.toUpperCase() || "File";

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={LABEL}>{label}</span>
        {!fileName ? (
          <label
            htmlFor={id}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <FileUp className="h-3.5 w-3.5" />
            Choose file
          </label>
        ) : null}
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onSelect(file);
            event.target.value = "";
          }}
        />
      </div>

      {fileName ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-neutral-800">{fileName}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {fileType} · {isUploading && pendingFile ? "Uploading…" : pendingFile ? "Ready to upload" : "Saved"}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={isUploading}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            aria-label={`Remove ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-neutral-500">No file selected.</p>
      )}
    </div>
  );
}

function StepNavigation({
  currentStep,
  onStepChange,
  onSaveDraft,
  isSavingDraft,
  saveDraftLabel = "Save Draft",
  onSubmit,
  isSubmitting,
  submitLabel = "Submit ECR",
  isBusy,
}: {
  currentStep: number;
  onStepChange: (step: number) => void;
  onSaveDraft: () => void;
  isSavingDraft: boolean;
  saveDraftLabel?: string;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitLabel?: string;
  isBusy?: boolean;
}) {
  const previous = currentStep > 0 ? STEP_TITLES[currentStep - 1] : null;
  const next = currentStep < STEP_TITLES.length - 1
    ? STEP_TITLES[currentStep + 1]
    : null;

  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-neutral-100 pt-4">
      {previous ? (
        <button
          type="button"
          onClick={() => onStepChange(currentStep - 1)}
          className="inline-flex h-10 min-w-0 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 sm:px-4"
        >
          <ChevronLeft className="h-4 w-4 flex-none" />
          <span className="truncate">{previous}</span>
        </button>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={isBusy}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 shadow-xs transition-colors sm:px-4"
        >
          {isSavingDraft ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4 text-neutral-500" />
          )}
          <span>{saveDraftLabel}</span>
        </button>

        {next ? (
          <button
            type="button"
            onClick={() => onStepChange(currentStep + 1)}
            className="inline-flex h-10 min-w-0 items-center gap-1 rounded-md bg-primary-600 px-3 text-[13px] font-semibold text-white hover:bg-primary-700 sm:px-4"
          >
            <span className="truncate">Next: {next}</span>
            <ChevronRight className="h-4 w-4 flex-none" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={isBusy}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-[13px] font-semibold text-white hover:bg-primary-700 disabled:opacity-60 shadow-xs transition-colors"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>{submitLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function NewECRPage() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const isEditing = Boolean(name);
  const user = useAuthStore((s) => s.user);
  const hydratedEcrRef = useRef<string | null>(null);
  // Retained until the whole create + optional submit attempt succeeds. If a
  // response is lost after ERP commits, a manual retry resolves the same ECR.
  const createIdempotencyKeyRef = useRef<string | null>(null);

  const editQuery = useQuery({
    queryKey: ["ecr", name],
    queryFn: () => fetchECR(name!),
    enabled: isEditing,
  });
  const existingECR = editQuery.data;

  useEffect(() => {
    if (!existingECR || !name) return;
    const publicNumber = formatECRNumber(existingECR);
    if (name.toUpperCase() !== publicNumber.toUpperCase()) {
      navigate(`/ecr/${encodeURIComponent(publicNumber)}/edit`, { replace: true });
    }
  }, [existingECR, name, navigate]);

  const [form, setForm] = useState<Partial<CreateECRPayload>>({
    ecr_title: "",
    ecr_type: "Part Change",
    priority: "Medium",
    requesting_department: user?.department || "",
    plant: "",
    program: "",
    project: "",
    target_implementation_date: "",
    chnage_description: "",
    reason_for_change: "",
    business_justification: "",
    current_state: "",
    proposed_state: "",
    supplier_response_required: "No",
    supplier_response_type: "Quotation",
    suggested_supplier: "",
    procurement_reference_type: "None",
    existing_rfq_reference: "",
    existing_purchase_order_reference: "",
    required_quantity: 1,
    quantity_uom: "Nos",
    engineering_notes: "",
    implementation_notes: "",
    implementation_date: "",
    validation_status: "Not Started",
    validation_notes: "",
    validation_documents: "",
    ecr_owner: user?.email?.trim().toLowerCase() || user?.name || "",
  });

  const [impacts, setImpacts] = useState<Record<ImpactField, boolean>>({
    product_impact: false,
    material_impact: false,
    manufacturing_impact: false,
    tooling_impact: false,
    quality_impact: false,
    cost_impact: false,
    supplier_impact: false,
    delivery_impact: false,
    customer_impact: false,
    contract_impact: false,
  });

  // Conditional impact details
  const [costImpactDetail, setCostImpactDetail] = useState("");
  const [supplierImpactDetail, setSupplierImpactDetail] = useState("");
  const [customerImpactDetail, setCustomerImpactDetail] = useState("");
  const [contractImpactDetail, setContractImpactDetail] = useState("");

  // Supplier requirement sub-fields
  const [techRequirements, setTechRequirements] = useState("");
  const [commRequirements, setCommRequirements] = useState("");
  const [deliveryRequirements, setDeliveryRequirements] = useState("");
  const [qualityRequirements, setQualityRequirements] = useState("");

  const [parts, setParts] = useState<Partial<ECRAffectedPart>[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validReferences, setValidReferences] = useState<Record<string, boolean>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmittingWorkflow, setIsSubmittingWorkflow] = useState(false);
  const [isValidatingReferences, setIsValidatingReferences] = useState(false);

  // File uploads
  const [drawingFile, setDrawingFile] = useState<string>("");
  const [cadFile, setCadFile] = useState<string>("");
  const [specFile, setSpecFile] = useState<string>("");
  const [supportingDocs, setSupportingDocs] = useState<string>("");
  const [validationDocs, setValidationDocs] = useState<string>("");
  const [pendingDocuments, setPendingDocuments] = useState<
    Partial<Record<DocumentField, File>>
  >({});

  const supplierId = form.suggested_supplier?.trim() || "";
  const procurementReferenceType: ECRProcurementReferenceType =
    form.procurement_reference_type === "RFQ" ? "RFQ" : "None";
  const isProcurementSourced =
    form.supplier_response_required === "Yes" && procurementReferenceType !== "None";
  const selectedSourceDocument = procurementReferenceType === "RFQ"
    ? form.existing_rfq_reference?.trim() || ""
    : "";

  const supplierRfqsQuery = useQuery({
    queryKey: ["ecr-procurement-rfqs", supplierId],
    queryFn: () => fetchECRSupplierRFQs(supplierId),
    enabled: Boolean(supplierId) && procurementReferenceType === "RFQ",
    staleTime: 30_000,
  });

  const sourceItemsQuery = useQuery({
    queryKey: [
      "ecr-procurement-source-items",
      procurementReferenceType,
      selectedSourceDocument,
      supplierId,
    ],
    queryFn: () => fetchECRProcurementSourceItems(
      procurementReferenceType as Exclude<ECRProcurementReferenceType, "None">,
      selectedSourceDocument,
      supplierId,
    ),
    enabled: Boolean(
      supplierId &&
      selectedSourceDocument &&
      procurementReferenceType !== "None"
    ),
    staleTime: 30_000,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      data: CreateECRPayload;
      submitImmediately: boolean;
      idempotencyKey?: string;
    }) => {
      let ecr: ECRSaveResult;
      if (isEditing && name) {
        // Owner is a server-owned ERP User link and must not be rewritten by
        // a Sent Back edit, even though it remains visible in the form.
        const editableData: Partial<CreateECRPayload> = { ...payload.data };
        delete editableData.ecr_owner;
        ecr = await updateECR(existingECR?.name || name, editableData);
      } else {
        ecr = await createECR(payload.data, {
          idempotencyKey: payload.idempotencyKey,
        });
      }

      const uploader = user?.email || user?.name || "Engineer";
      for (const [field, file] of Object.entries(pendingDocuments) as [
        DocumentField,
        File,
      ][]) {
        if (file) {
          const category = inferCategoryFromFieldName(field, file.name);
          try {
            await uploadECRAttachment(file, ecr.name, category, field, uploader);
          } catch (uploadErr) {
            console.warn(`[NewECRPage] Failed to upload ${file.name} for field ${field}:`, uploadErr);
          }
        }
      }

      const workflowAction = getECRPostSaveWorkflowAction(ecr, {
        submitImmediately: payload.submitImmediately,
        isEditing,
      });
      if (workflowAction) {
        const result = await submitECR(ecr.name);
        if (!result.success) throw new Error(result.message || "Unable to submit ECR.");
      }
      return ecr;
    },
    onError: (error) => {
      const errObj = error as {
        fieldErrors?: Record<string, string>;
        response?: { data?: { field_errors?: Record<string, string> } };
      };
      const fieldErrors = errObj.fieldErrors || errObj.response?.data?.field_errors;
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        const keys = Object.keys(fieldErrors);
        goToStep(keys.some((key) => [
          "suggested_supplier",
          "existing_rfq_reference",
          "existing_purchase_order_reference",
        ].includes(key)) ? 4 : 2);
      }
      const msg = extractECRErrorMessage(error);
      toast.error(msg);
    },
    onSuccess: (ecr, variables) => {
      createIdempotencyKeyRef.current = null;
      const businessNumber = formatECRNumber(ecr);
      toast.success(
        variables.submitImmediately
          ? `${businessNumber} submitted for Engineering Review.`
          : `${businessNumber} saved as Draft.`,
      );
      navigate(`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`);
    },
  });

  useEffect(() => {
    const ecr = editQuery.data;
    if (!ecr || hydratedEcrRef.current === ecr.name) return;
    hydratedEcrRef.current = ecr.name;
    const noteSections = parseECREngineeringNotes(ecr.engineering_notes);
    // React Query data is the external source used to hydrate the edit form once.
    setForm({
      ecr_title: ecr.ecr_title,
      ecr_type: ecr.ecr_type || "Part Change",
      priority: ecr.priority || "Medium",
      ecr_owner: ecr.ecr_owner || ecr.amended_from || user?.email?.trim().toLowerCase() || user?.name || "",
      requesting_department: ecr.requesting_department,
      plant: ecr.plant,
      program: ecr.program || "",
      project: ecr.project || "",
      target_implementation_date: ecr.target_implementation_date,
      chnage_description: ecr.chnage_description,
      reason_for_change: ecr.reason_for_change,
      business_justification: ecr.business_justification || "",
      current_state: ecr.current_state || "",
      proposed_state: ecr.proposed_state || "",
      supplier_response_required:
        ecr.supplier_response_required === "Yes" || ecr.supplier_impact === 1 ? "Yes" : "No",
      supplier_response_type: ecr.supplier_response_type || "Quotation",
      suggested_supplier: ecr.suggested_supplier || "",
      procurement_reference_type: ecr.procurement_reference_type === "RFQ" ? "RFQ" : "None",
      existing_rfq_reference: ecr.existing_rfq_reference || "",
      existing_purchase_order_reference: ecr.existing_purchase_order_reference || "",
      required_quantity: ecr.required_quantity || 1,
      quantity_uom: ecr.quantity_uom || "Nos",
      engineering_notes: noteSections.engineeringNotes,
      implementation_notes: ecr.implementation_notes || "",
      implementation_date: ecr.implementation_date || "",
      validation_status: ecr.validation_status || "Not Started",
      validation_notes: ecr.validation_notes || "",
      validation_documents: ecr.validation_documents || "",
    });
    setParts(ecr.affected_parts?.length ? ecr.affected_parts : []);
    setImpacts({
      product_impact: ecr.product_impact === 1,
      material_impact: ecr.material_impact === 1,
      manufacturing_impact: ecr.manufacturing_impact === 1,
      tooling_impact: ecr.tooling_impact === 1,
      quality_impact: ecr.quality_impact === 1,
      cost_impact: ecr.cost_impact === 1,
      supplier_impact: ecr.supplier_impact === 1,
      delivery_impact: ecr.delivery_impact === 1,
      customer_impact: ecr.customer_impact === 1,
      contract_impact: ecr.contract_impact === 1,
    });
    setCostImpactDetail(noteSections.costImpact);
    setSupplierImpactDetail(noteSections.supplierImpact);
    setCustomerImpactDetail(noteSections.customerImpact);
    setContractImpactDetail(noteSections.contractImpact);
    setTechRequirements(noteSections.technicalRequirements);
    setCommRequirements(noteSections.commercialRequirements);
    setDeliveryRequirements(noteSections.deliveryRequirements);
    setQualityRequirements(noteSections.qualityRequirements);
    setDrawingFile(ecr.engineering_drawing || "");
    setCadFile(ecr["3d_cad_file"] || "");
    setSpecFile(ecr.specification || "");
    setSupportingDocs(ecr.supporting_documents || "");
    setValidationDocs(ecr.validation_documents || "");

    // Hydrate attached documents from attachment persistence
    fetchECRAttachments(ecr.name, ecr)
      .then((attachments) => {
        for (const att of attachments) {
          if (att.field_name === "engineering_drawing") setDrawingFile(att.file_url);
          if (att.field_name === "3d_cad_file") setCadFile(att.file_url);
          if (att.field_name === "specification") setSpecFile(att.file_url);
          if (att.field_name === "supporting_documents") setSupportingDocs(att.file_url);
          if (att.field_name === "validation_documents") setValidationDocs(att.file_url);
        }
      })
      .catch(() => {});
  }, [editQuery.data, user?.email, user?.name]);

  if (!user || (!isEditing && !canCreateECR(user.role))) return <AccessDenied />;
  if (isEditing && editQuery.isLoading) {
    return <div className="flex min-h-[400px] items-center justify-center text-sm text-neutral-500"><Loader2 className="mr-2 h-4 w-4 animate-spin text-primary-600" />Loading ECR for editing…</div>;
  }
  if (
    isEditing &&
    (!editQuery.data || !canEditECR(user.role, editQuery.data.select_pxfp, editQuery.data, user))
  ) {
    return <AccessDenied />;
  }

  function updatePart(idx: number, field: keyof ECRAffectedPart, value: string | number) {
    setParts((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
    if (field === "partitem") {
      setValidReferences((prev) => ({ ...prev, [`partitem.${idx}`]: false }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.parts;
        delete next[`partitem.${idx}`];
        return next;
      });
    }
  }

  function removePart(idx: number) {
    setParts((prev) => prev.filter((_, i) => i !== idx));
    setErrors((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => !key.startsWith("partitem.")),
    ));
    setValidReferences((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => !key.startsWith("partitem.")),
    ));
  }

  function clearReferenceFeedback(field: string) {
    setValidReferences((prev) => ({ ...prev, [field]: false }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function clearProcurementFeedback(includeSupplier = false) {
    const procurementFields = new Set([
      "procurement_reference_type",
      "existing_rfq_reference",
      "existing_purchase_order_reference",
      "procurement_items",
      "parts",
    ]);
    setErrors((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) =>
        !(procurementFields.has(key) || key.startsWith("partitem.") || (includeSupplier && key === "suggested_supplier"))
      ),
    ));
    setValidReferences((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) =>
        !(key.startsWith("partitem.") || key === "existing_rfq_reference" || key === "existing_purchase_order_reference" || (includeSupplier && key === "suggested_supplier"))
      ),
    ));
  }

  function handleSupplierRequiredChange(required: "Yes" | "No") {
    if (required === "Yes") {
      setForm((prev) => ({ ...prev, supplier_response_required: "Yes" }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      supplier_response_required: "No",
      suggested_supplier: "",
      procurement_reference_type: "None",
      existing_rfq_reference: "",
      existing_purchase_order_reference: "",
    }));
    setParts((prev) => prev.filter((part) => !part.source_item_reference));
    setImpacts((prev) => ({ ...prev, supplier_impact: false }));
    clearProcurementFeedback(true);
  }

  function toggleImpact(key: ImpactField) {
    const enabled = !impacts[key];
    setImpacts((prev) => ({ ...prev, [key]: enabled }));
    if (key === "supplier_impact" && enabled) {
      handleSupplierRequiredChange("Yes");
    }
  }

  function handleSupplierChange(
    value: string,
    selected: boolean,
  ) {
    if (selected && value === supplierId) {
      clearReferenceFeedback("suggested_supplier");
      setValidReferences((prev) => ({ ...prev, suggested_supplier: true }));
      return;
    }
    if (!selected && value) return;
    setForm((prev) => ({
      ...prev,
      suggested_supplier: value,
      existing_rfq_reference: "",
      existing_purchase_order_reference: "",
    }));
    setParts([]);
    clearProcurementFeedback(true);
    if (selected) {
      setValidReferences((prev) => ({ ...prev, suggested_supplier: true }));
    }
  }

  function handleReferenceTypeChange(nextType: ECRProcurementReferenceType) {
    setForm((prev) => ({
      ...prev,
      procurement_reference_type: nextType,
      existing_rfq_reference: "",
      existing_purchase_order_reference: "",
    }));
    setParts([]);
    clearProcurementFeedback();
  }

  function handleSourceDocumentChange(value: string, selected: boolean) {
    if (!selected) return;
    if (value === selectedSourceDocument) {
      const field = procurementReferenceType === "RFQ"
        ? "existing_rfq_reference"
        : "existing_purchase_order_reference";
      clearReferenceFeedback(field);
      setValidReferences((prev) => ({ ...prev, [field]: true }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      existing_rfq_reference: procurementReferenceType === "RFQ" ? value : "",
      existing_purchase_order_reference:
        procurementReferenceType === "Purchase Order" ? value : "",
    }));
    setParts([]);
    clearProcurementFeedback();
    if (selected) {
      const field = procurementReferenceType === "RFQ"
        ? "existing_rfq_reference"
        : "existing_purchase_order_reference";
      setValidReferences((prev) => ({ ...prev, [field]: true }));
    }
  }

  function toggleSourceItem(item: ECRProcurementSourceItem) {
    const existingIndex = parts.findIndex(
      (part) => part.source_item_reference === item.sourceItemReference,
    );
    if (existingIndex >= 0) {
      removePart(existingIndex);
      return;
    }

    const sourceType = procurementReferenceType as Exclude<
      ECRProcurementReferenceType,
      "None"
    >;
    setParts((prev) => [
      ...prev,
      {
        ...emptyPart(),
        partitem: item.itemId,
        part_description: item.description,
        quantity: item.quantity,
        uom: item.uom,
        current_supplier: supplierId,
        source_reference_type: sourceType,
        source_document_reference: selectedSourceDocument,
        source_item_reference: item.sourceItemReference,
      },
    ]);
    setValidReferences((prev) => ({
      ...prev,
      [`partitem.${parts.length}`]: true,
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.parts;
      delete next.procurement_items;
      return next;
    });
  }

  function goToStep(step: number) {
    const nextStep = Math.max(0, Math.min(STEP_TITLES.length - 1, step));
    setCurrentStep(nextStep);
    requestAnimationFrame(() => {
      document.getElementById(STEP_IDS[nextStep])?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function setSavedDocument(field: DocumentField, value: string) {
    if (field === "engineering_drawing") setDrawingFile(value);
    if (field === "3d_cad_file") setCadFile(value);
    if (field === "specification") setSpecFile(value);
    if (field === "supporting_documents") setSupportingDocs(value);
    if (field === "validation_documents") setValidationDocs(value);
  }

  function selectDocument(field: DocumentField, file: File) {
    setSavedDocument(field, "");
    setPendingDocuments((prev) => ({ ...prev, [field]: file }));
  }

  function removeDocument(field: DocumentField) {
    setSavedDocument(field, "");
    setPendingDocuments((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function requiredFieldError(field: string): string {
    if (field === "ecr_owner" && !form.ecr_owner?.trim()) return "ECR owner is required.";
    if (field === "ecr_title" && !form.ecr_title?.trim()) return "ECR title is required.";
    if (field === "ecr_type" && !form.ecr_type) return "ECR type is required.";
    if (field === "priority" && !form.priority) return "Priority is required.";
    if (field === "requesting_department" && !form.requesting_department?.trim()) {
      return "Requesting department is required.";
    }
    if (field === "plant" && !form.plant?.trim()) return "Plant is required.";
    if (field === "target_implementation_date" && !form.target_implementation_date) {
      return "Target implementation date is required.";
    }
    if (field === "chnage_description" && !form.chnage_description?.trim()) {
      return "Change description is required.";
    }
    if (field === "reason_for_change" && !form.reason_for_change?.trim()) {
      return "Reason for change is required.";
    }
    return "";
  }

  function validateField(field: string) {
    const message = requiredFieldError(field);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const field of [
      "ecr_owner",
      "ecr_title",
      "ecr_type",
      "priority",
      "requesting_department",
      "plant",
      "target_implementation_date",
      "chnage_description",
      "reason_for_change",
    ]) {
      const message = requiredFieldError(field);
      if (message) errs[field] = message;
    }

    if (form.supplier_response_required === "Yes") {
      if (!form.suggested_supplier?.trim()) {
        errs.suggested_supplier = "Supplier is required.";
      }
      if (procurementReferenceType === "RFQ" && !form.existing_rfq_reference?.trim()) {
        errs.existing_rfq_reference = "RFQ is required.";
      }
      if (
        procurementReferenceType === "Purchase Order" &&
        !form.existing_purchase_order_reference?.trim()
      ) {
        errs.existing_purchase_order_reference = "Purchase Order is required.";
      }
    }

    const validParts = parts.filter((p) => p.partitem?.trim());
    if (validParts.length === 0) {
      if (
        form.supplier_response_required === "Yes" &&
        procurementReferenceType !== "None"
      ) {
        errs.procurement_items = `Select at least one affected item from the ${procurementReferenceType}.`;
      } else {
        errs.parts = "Add at least one affected part with a part number.";
      }
    }

    setErrors(errs);
    const firstField = Object.keys(errs)[0];
    if (firstField) {
      const errorStep = firstField === "chnage_description" || firstField === "reason_for_change"
        ? 1
        : firstField === "parts" || firstField.startsWith("partitem.")
          ? 2
          : [
              "suggested_supplier",
              "procurement_reference_type",
              "existing_rfq_reference",
              "existing_purchase_order_reference",
              "procurement_items",
            ].includes(firstField)
            ? 4
            : 0;
      setCurrentStep(errorStep);
      requestAnimationFrame(() => {
        document.getElementById(STEP_IDS[errorStep])?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
    return Object.keys(errs).length === 0;
  }

  async function handleSave(submitImmediately: boolean) {
    if (!validate()) return;
    setIsSubmittingWorkflow(submitImmediately);
    setIsValidatingReferences(true);

    const referenceValidation = await validateECRMasterReferences({
      owner: form.ecr_owner || user?.email || user?.name || "",
      department: form.requesting_department || "",
      plant: form.plant || "",
      supplier: form.supplier_response_required === "Yes"
        ? form.suggested_supplier || ""
        : "",
      parts,
    });
    const procurementInput = canonicalizeECRProcurementSelectionInput({
      supplier: form.suggested_supplier || "",
      referenceType: form.supplier_response_required === "Yes"
        ? procurementReferenceType
        : "None",
      rfqId: form.existing_rfq_reference,
      purchaseOrderId: form.existing_purchase_order_reference,
      parts,
    }, {
      supplier: referenceValidation.canonical.supplier,
      parts: referenceValidation.canonical.parts,
    });
    const procurementValidation = await validateECRProcurementSelection(procurementInput);

    setValidReferences(Object.fromEntries(
      referenceValidation.validFields.map((field) => [field, true]),
    ));
    const validationErrors = {
      ...procurementValidation.errors,
      // Prefer the more precise master-data error when the same field failed
      // both canonical resolution and procurement relationship validation.
      ...referenceValidation.errors,
    };
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setIsValidatingReferences(false);
      setIsSubmittingWorkflow(false);
      const keys = Object.keys(validationErrors);
      const errorStep = keys.some((key) =>
        ["ecr_owner", "requesting_department", "plant"].includes(key)
      )
        ? 0
        : keys.some((key) => [
            "suggested_supplier",
            "existing_rfq_reference",
            "existing_purchase_order_reference",
            "procurement_items",
          ].includes(key))
          ? 4
          : 2;
      goToStep(errorStep);
      return;
    }

    const canonicalReferenceType = form.supplier_response_required === "Yes"
      ? procurementReferenceType
      : "None";
    const canonicalForm: Partial<CreateECRPayload> = {
      ...form,
      ecr_owner: referenceValidation.canonical.owner,
      amended_from: undefined,
      requesting_department: referenceValidation.canonical.department,
      plant: referenceValidation.canonical.plant,
      suggested_supplier: form.supplier_response_required === "Yes"
        ? referenceValidation.canonical.supplier || ""
        : "",
      procurement_reference_type: canonicalReferenceType,
      existing_rfq_reference: canonicalReferenceType === "RFQ"
        ? form.existing_rfq_reference?.trim() || ""
        : "",
      existing_purchase_order_reference: canonicalReferenceType === "Purchase Order"
        ? form.existing_purchase_order_reference?.trim() || ""
        : "",
    };
    const canonicalParts = procurementValidation.canonicalParts.map((part, index) => ({
      ...part,
      partitem: referenceValidation.canonical.parts[index] || part.partitem,
    }));
    setForm(canonicalForm);
    setParts(canonicalParts);
    setErrors({});
    setIsValidatingReferences(false);

    const supplierRequired = canonicalForm.supplier_response_required === "Yes";
    const combinedNotes = serializeECREngineeringNotes({
      engineeringNotes: form.engineering_notes,
      costImpact: costImpactDetail,
      customerImpact: customerImpactDetail,
      contractImpact: contractImpactDetail,
      technicalRequirements: supplierRequired ? techRequirements : "",
      commercialRequirements: supplierRequired ? commRequirements : "",
      deliveryRequirements: supplierRequired ? deliveryRequirements : "",
      qualityRequirements: supplierRequired ? qualityRequirements : "",
      supplierImpact: supplierRequired ? supplierImpactDetail : "",
    });

    const cleanTargetDate = form.target_implementation_date?.trim()
      ? formatERPNextDate(form.target_implementation_date.trim()) || form.target_implementation_date.trim()
      : "";

    const cleanImplementationDate = form.implementation_date?.trim()
      ? formatERPNextDate(form.implementation_date.trim()) || undefined
      : undefined;

    const cleanParts = canonicalParts
      .filter((p) => p.partitem?.trim())
      .map((p) => ({
        partitem: p.partitem?.trim(),
        part_description: p.part_description?.trim() || undefined,
        current_revision: p.current_revision?.trim() || undefined,
        new_revision: p.new_revision?.trim() || undefined,
        quantity: typeof p.quantity === "number" && Number.isFinite(p.quantity)
          ? p.quantity
          : Number(p.quantity) || 1,
        uom: p.uom?.trim() || "Nos",
        change_required: p.change_required?.trim() || undefined,
        technical_notes: p.technical_notes?.trim() || undefined,
        current_supplier: p.current_supplier?.trim() || undefined,
        proposed_supplier: p.proposed_supplier?.trim() || undefined,
        plant: p.plant?.trim() || undefined,
        source_reference_type: p.source_reference_type || undefined,
        source_document_reference: p.source_document_reference?.trim() || undefined,
        source_item_reference: p.source_item_reference?.trim() || undefined,
      }));

    const payload: CreateECRPayload = {
      ...(canonicalForm as CreateECRPayload),
      target_implementation_date: cleanTargetDate,
      implementation_date: cleanImplementationDate,
      validation_status: form.validation_status || "Not Started",
      validation_notes: form.validation_notes?.trim() || undefined,
      implementation_notes: form.implementation_notes?.trim() || undefined,
      required_quantity: typeof form.required_quantity === "number" && Number.isFinite(form.required_quantity)
        ? form.required_quantity
        : Number(form.required_quantity) || 1,
      quantity_uom: form.quantity_uom || "Nos",
      engineering_notes: combinedNotes,
      ...(Object.fromEntries(
        Object.entries(impacts).map(([k, v]) => [k, v ? 1 : 0])
      ) as Record<ImpactField, 0 | 1>),
      affected_parts: cleanParts,
      engineering_drawing: drawingFile || undefined,
      "3d_cad_file": cadFile || undefined,
      specification: specFile || undefined,
      supporting_documents: supportingDocs || undefined,
      validation_documents: validationDocs || undefined,
    };

    let idempotencyKey: string | undefined;
    if (!isEditing) {
      createIdempotencyKeyRef.current ??= generateECRCreateIdempotencyKey();
      idempotencyKey = createIdempotencyKeyRef.current;
    }
    createMutation.mutate({ data: payload, submitImmediately, idempotencyKey });
  }

  const f =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    };

  const isBusy = createMutation.isPending || isValidatingReferences;
  const saveDraftLabel = isEditing ? "Save Changes" : "Save Draft";
  const isReturnedDraft =
    isEditing &&
    canonicalECRStage(editQuery.data?.select_pxfp) === "Draft" &&
    Boolean(editQuery.data?.approval_requirements?.some((row) => row.status === "Sent Back"));
  const submitLabel = isReturnedDraft ? "Resubmit ECR" : "Submit ECR";
  const isSavingDraft = isBusy && !isSubmittingWorkflow;
  const isSubmitting = isBusy && isSubmittingWorkflow;

  const procurementTraceability = getECRProcurementTraceability({
    ecr_number: editQuery.data?.ecr_number,
    select_pxfp: editQuery.data?.select_pxfp,
    supplier_response_required: form.supplier_response_required,
    procurement_reference_type: form.procurement_reference_type,
    existing_rfq_reference: form.existing_rfq_reference,
    existing_purchase_order_reference: form.existing_purchase_order_reference,
    purchase_requisition: editQuery.data?.purchase_requisition,
    rfq: editQuery.data?.rfq,
    supplier_quotation: editQuery.data?.supplier_quotation,
    selected_supplier: editQuery.data?.selected_supplier,
    purchase_order: editQuery.data?.purchase_order,
  });

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 px-4 py-5 sm:px-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5 text-[13px] text-neutral-500">
        <Link to="/ecr" className="hover:text-primary-700 font-medium">
          Engineering Changes
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
        <span className="text-neutral-800 font-semibold">
          {isEditing ? `Edit ${formatECRNumber(existingECR || name)}` : "New Change Request"}
        </span>
      </div>

      {/* ── Form Top Bar ── */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-neutral-900">{isEditing ? "Edit Engineering Change Request" : "Create Engineering Change Request"}</h1>
          <span className="rounded-full bg-neutral-100 border border-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
            {isEditing && existingECR ? canonicalECRStage(existingECR.select_pxfp) : "Draft"}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
          {isEditing
            ? "Update the request and resubmit it for Engineering Review."
            : "Submit a new engineering change for sequential engineering and procurement review."}
        </p>
      </div>

      {/* ── Read-Only Lock Banner for Submitted ECRs ── */}
      {isEditing && existingECR && canonicalECRStage(existingECR.select_pxfp) !== "Draft" && canonicalECRStage(existingECR.select_pxfp) !== "Sent Back" && (
        <div className="rounded-xl border border-amber-300 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-100 p-2 text-amber-800 flex-shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-neutral-900">
                This ECR has already been submitted and cannot be changed.
              </h2>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Original ECR information is locked while under active review ({canonicalECRStage(existingECR.select_pxfp)}).
                Assigned reviewers can enter their evaluations and approval decisions directly on the ECR details page.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <Link
              to={`/ecr/${encodeURIComponent(formatECRNumber(existingECR))}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700 shadow-xs transition-colors"
            >
              View ECR Details
            </Link>
          </div>
        </div>
      )}

      {/* ── Mutation Error ── */}
      {createMutation.isError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-600" />
          <span>
            {extractECRErrorMessage(createMutation.error)}
          </span>
        </div>
      )}

      {/* ── Form Sections ── */}
      {(!isEditing || !existingECR || canonicalECRStage(existingECR.select_pxfp) === "Draft" || canonicalECRStage(existingECR.select_pxfp) === "Sent Back") && (
      <form onSubmit={(e) => { e.preventDefault(); void handleSave(false); }} className="space-y-5 pb-4">
        {/* 1. Basic Information */}
        <section id="basic-information" className={`${SECTION_CARD} ${currentStep === 0 ? "" : "hidden"}`}>
          <SectionHeading
            number={1}
            title="Basic Information"
            description="General attributes, ownership and target implementation date."
          />

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className={FIELD_CONTAINER} data-field="ecr_title">
                <label className={LABEL}>ECR Title *</label>
                <input
                  type="text"
                  value={form.ecr_title}
                  onChange={f("ecr_title")}
                  onBlur={() => validateField("ecr_title")}
                  placeholder="e.g., Door Latch Reinforcement Bracket Geometry Modification"
                  aria-invalid={Boolean(errors.ecr_title)}
                  className={`${INPUT} ${errors.ecr_title ? "border-rose-400" : ""}`}
                />
                {errors.ecr_title && (
                  <span className={ERROR}>{errors.ecr_title}</span>
                )}
              </div>
            </div>

            <div className={FIELD_CONTAINER} data-field="ecr_type">
              <label className={LABEL}>ECR Type *</label>
              <select value={form.ecr_type} onChange={f("ecr_type")} onBlur={() => validateField("ecr_type")} className={SELECT}>
                {ECR_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.ecr_type ? <span className={ERROR}>{errors.ecr_type}</span> : null}
            </div>

            <div className={FIELD_CONTAINER} data-field="priority">
              <label className={LABEL}>Priority *</label>
              <select value={form.priority} onChange={f("priority")} onBlur={() => validateField("priority")} className={SELECT}>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
              {errors.priority ? <span className={ERROR}>{errors.priority}</span> : null}
            </div>

            <div className={FIELD_CONTAINER} data-field="ecr_owner">
              <label className={LABEL}>ECR Owner</label>
              <input
                type="text"
                value={form.ecr_owner || user.email || user.name}
                aria-invalid={Boolean(errors.ecr_owner)}
                className={`${INPUT} ${errors.ecr_owner ? "border-rose-400" : ""}`}
                readOnly
              />
              {errors.ecr_owner ? (
                <span className={ERROR}>{errors.ecr_owner}</span>
              ) : validReferences.ecr_owner ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <Check className="h-3 w-3" /> Valid
                </span>
              ) : null}
            </div>

            <div className={FIELD_CONTAINER} data-field="requesting_department">
              <label className={LABEL}>Requesting Department *</label>
              <ECRMasterDataPicker
                kind="department"
                value={form.requesting_department || ""}
                onChange={(value, selected) => {
                  setForm((prev) => ({ ...prev, requesting_department: value }));
                  clearReferenceFeedback("requesting_department");
                  if (selected) {
                    setValidReferences((prev) => ({ ...prev, requesting_department: true }));
                  }
                }}
                placeholder="Search department..."
                error={errors.requesting_department}
                valid={validReferences.requesting_department}
                inputClassName={INPUT}
              />
            </div>

            <div className={FIELD_CONTAINER} data-field="plant">
              <label className={LABEL}>Plant *</label>
              <ECRMasterDataPicker
                kind="plant"
                value={form.plant || ""}
                onChange={(value, selected) => {
                  setForm((prev) => ({ ...prev, plant: value }));
                  clearReferenceFeedback("plant");
                  if (selected) {
                    setValidReferences((prev) => ({ ...prev, plant: true }));
                  }
                }}
                placeholder="Search plant..."
                error={errors.plant}
                valid={validReferences.plant}
                inputClassName={INPUT}
              />
            </div>

            <div className={FIELD_CONTAINER} data-field="target_implementation_date">
              <label className={LABEL}>Target Implementation Date *</label>
              <input
                type="date"
                value={form.target_implementation_date}
                onChange={f("target_implementation_date")}
                onBlur={() => validateField("target_implementation_date")}
                aria-invalid={Boolean(errors.target_implementation_date)}
                className={`${INPUT} ${errors.target_implementation_date ? "border-rose-400" : ""}`}
              />
              {errors.target_implementation_date && (
                <span className={ERROR}>{errors.target_implementation_date}</span>
              )}
            </div>

            <div className={FIELD_CONTAINER}>
              <label className={LABEL}>Program</label>
              <input
                type="text"
                value={form.program}
                onChange={f("program")}
                placeholder="e.g. G20 Platform / EV-2026"
                className={INPUT}
              />
            </div>

            <div className={FIELD_CONTAINER}>
              <label className={LABEL}>Project Code</label>
              <input
                type="text"
                value={form.project}
                onChange={f("project")}
                placeholder="e.g. PRJ-LAT-042"
                className={INPUT}
              />
            </div>
          </div>
          <StepNavigation
            currentStep={0}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 2. Change Details */}
        <section id="change-details" className={`${SECTION_CARD} ${currentStep === 1 ? "" : "hidden"}`}>
          <SectionHeading
            number={2}
            title="Change Details"
            description="Explain what is changing and why."
          />

          <div className="space-y-3.5">
            <div className={FIELD_CONTAINER} data-field="chnage_description">
              <label className={LABEL}>Change Description *</label>
              <textarea
                rows={3}
                value={form.chnage_description}
                onChange={f("chnage_description")}
                onBlur={() => validateField("chnage_description")}
                placeholder="Describe the exact technical changes required, dimension updates, tolerances, material alterations…"
                aria-invalid={Boolean(errors.chnage_description)}
                className={`${TEXTAREA} ${errors.chnage_description ? "border-rose-400" : ""}`}
              />
              {errors.chnage_description && (
                <span className={ERROR}>{errors.chnage_description}</span>
              )}
            </div>

            <div className={FIELD_CONTAINER} data-field="reason_for_change">
              <label className={LABEL}>Reason for Change *</label>
              <textarea
                rows={2}
                value={form.reason_for_change}
                onChange={f("reason_for_change")}
                onBlur={() => validateField("reason_for_change")}
                placeholder="Why is this change necessary? (e.g., Weight reduction, warranty issue, OEM specification update)"
                aria-invalid={Boolean(errors.reason_for_change)}
                className={`${TEXTAREA} ${errors.reason_for_change ? "border-rose-400" : ""}`}
              />
              {errors.reason_for_change && (
                <span className={ERROR}>{errors.reason_for_change}</span>
              )}
            </div>

            <div className={FIELD_CONTAINER}>
              <label className={LABEL}>Business Justification</label>
              <textarea
                rows={2}
                value={form.business_justification}
                onChange={f("business_justification")}
                placeholder="Financial or operational case (e.g. $1.20 cost saving per vehicle, 15% cycle time improvement)…"
                className={TEXTAREA}
              />
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Current State</label>
                <textarea
                  rows={2}
                  value={form.current_state}
                  onChange={f("current_state")}
                  placeholder="Existing baseline design, material specification, or process..."
                  className={TEXTAREA}
                />
              </div>

              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Proposed State</label>
                <textarea
                  rows={2}
                  value={form.proposed_state}
                  onChange={f("proposed_state")}
                  placeholder="Target state after engineering change is executed..."
                  className={TEXTAREA}
                />
              </div>
            </div>
          </div>
          <StepNavigation
            currentStep={1}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 3. Affected Parts */}
        <section id="affected-parts" className={`${SECTION_CARD} ${currentStep === 2 ? "" : "hidden"}`} data-field="parts">
          <SectionHeading
            number={3}
            title="Affected Parts"
            description="Specify the parts, revisions and quantities impacted by this change."
            aside={isProcurementSourced ? (
              <span className="hidden rounded-md bg-primary-50 px-2 py-1 text-[10px] font-semibold text-primary-700 sm:block">
                Sourced from {procurementReferenceType}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setParts((prev) => [...prev, emptyPart()])}
                className="inline-flex h-8 flex-none items-center gap-1 rounded-md border border-primary-300 bg-primary-50 px-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-100"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Part
              </button>
            )}
          />

          {errors.parts && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{errors.parts}</span>
            </div>
          )}

          {parts.length === 0 ? (
            <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 px-4 py-5 text-center">
              <p className="text-sm font-medium text-neutral-700">
                {isProcurementSourced
                  ? `Select affected items from the ${procurementReferenceType} in Supplier Impact.`
                  : "No affected parts added."}
              </p>
              {!isProcurementSourced ? (
                <button
                  type="button"
                  onClick={() => setParts([emptyPart()])}
                  className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Part
                </button>
              ) : null}
            </div>
          ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="min-w-[920px] w-full text-left text-xs text-neutral-700">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-600">
                <tr>
                  <th className="px-2.5 py-2">Part / Item *</th>
                  <th className="px-2.5 py-2">Part Name</th>
                  <th className="px-2 py-2">Current Revision</th>
                  <th className="px-2 py-2">New Revision</th>
                  <th className="px-2 py-2">Quantity</th>
                  <th className="px-2 py-2">UOM</th>
                  <th className="px-2.5 py-2">Change / Impact</th>
                  <th className="w-12 px-1.5 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {parts.map((part, idx) => (
                  <tr key={idx} className="hover:bg-neutral-50/50">
                    <td className="p-1.5">
                      {part.source_item_reference ? (
                        <div
                          className="w-36 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5"
                          title={`${part.source_document_reference || "Source document"} · ${part.source_item_reference}`}
                        >
                          <span className="block truncate font-mono text-xs font-semibold text-primary-700">
                            {part.partitem || "—"}
                          </span>
                          {errors[`partitem.${idx}`] ? (
                            <span className="mt-1 block text-[10px] font-medium text-rose-600">
                              {errors[`partitem.${idx}`]}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <ECRMasterDataPicker
                          kind="item"
                          value={part.partitem || ""}
                          onChange={(value, selected) => {
                            updatePart(idx, "partitem", value);
                            if (selected) {
                              setValidReferences((prev) => ({ ...prev, [`partitem.${idx}`]: true }));
                              if (selected.description) {
                                setParts((prev) => prev.map((row, rowIndex) =>
                                   rowIndex === idx && !row.part_description
                                    ? { ...row, part_description: selected.description?.split(" · ")[0] || "" }
                                    : row,
                                ));
                              }
                            }
                          }}
                          placeholder="Search item..."
                          error={errors[`partitem.${idx}`]}
                          valid={validReferences[`partitem.${idx}`]}
                          inputClassName="h-8 w-36 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
                          compact
                        />
                      )}
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={part.part_description || ""}
                        onChange={(e) => updatePart(idx, "part_description", e.target.value)}
                        readOnly={Boolean(part.source_item_reference)}
                        placeholder="Bracket Assembly"
                        className="w-36 rounded border border-neutral-300 px-2 py-1 text-xs read-only:bg-neutral-50 read-only:text-neutral-600 focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={part.current_revision || ""}
                        onChange={(e) => updatePart(idx, "current_revision", e.target.value)}
                        placeholder="Rev A"
                        className="w-16 rounded border border-neutral-300 px-2 py-1 text-xs text-center focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={part.new_revision || ""}
                        onChange={(e) => updatePart(idx, "new_revision", e.target.value)}
                        placeholder="Rev B"
                        className="w-16 rounded border border-neutral-300 px-2 py-1 text-xs text-center font-semibold text-emerald-700 focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="number"
                        value={part.quantity ?? ""}
                        onChange={(e) => updatePart(idx, "quantity", Number(e.target.value))}
                        readOnly={Boolean(part.source_item_reference)}
                        placeholder="1"
                        className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs text-center focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={part.uom || "Nos"}
                        onChange={(e) => updatePart(idx, "uom", e.target.value)}
                        readOnly={Boolean(part.source_item_reference)}
                        placeholder="Nos"
                        className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs text-center focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={part.change_required || ""}
                        onChange={(e) => updatePart(idx, "change_required", e.target.value)}
                        placeholder="Detail of part change"
                        className="w-44 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removePart(idx)}
                        className="p-1 text-neutral-400 transition-colors hover:text-rose-600"
                        title="Remove part"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <StepNavigation
            currentStep={2}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 4. Impact Assessment */}
        <section id="impact-assessment" className={`${SECTION_CARD} ${currentStep === 3 ? "" : "hidden"}`}>
          <SectionHeading
            number={4}
            title="Impact Assessment"
            description="Identify the cross-functional areas affected by this change."
          />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {(
              [
                ["product_impact", "Product Impact"],
                ["material_impact", "Material Impact"],
                ["manufacturing_impact", "Manufacturing Impact"],
                ["tooling_impact", "Tooling Impact"],
                ["quality_impact", "Quality Impact"],
                ["cost_impact", "Cost Impact"],
                ["supplier_impact", "Supplier Impact"],
                ["delivery_impact", "Delivery Impact"],
                ["customer_impact", "Customer Impact"],
                ["contract_impact", "Contract Impact"],
              ] as [ImpactField, string][]
            ).map(([key, label]) => {
              const isChecked = impacts[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleImpact(key)}
                  className={`flex items-center justify-between rounded-lg border p-2.5 text-xs text-left transition-all ${
                    isChecked
                      ? "border-primary-300 bg-primary-50 font-semibold text-primary-800"
                      : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${isChecked ? "border-primary-600 bg-primary-600 text-white" : "border-neutral-300 bg-white text-transparent"}`}>
                    <Check className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Conditional Impact Detail Fields */}
          <div className="space-y-3 pt-2">
            {impacts.cost_impact && (
              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Cost Impact Details / Amount</label>
                <input
                  type="text"
                  value={costImpactDetail}
                  onChange={(e) => setCostImpactDetail(e.target.value)}
                  placeholder="e.g. Unit cost decrease of $0.85; Tooling cost $12,500 amortized over 50,000 units"
                  className={INPUT}
                />
              </div>
            )}

            {impacts.supplier_impact && (
              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Supplier Impact Notes</label>
                <input
                  type="text"
                  value={supplierImpactDetail}
                  onChange={(e) => setSupplierImpactDetail(e.target.value)}
                  placeholder="e.g. Tier 1 supplier retooling required; estimated lead time 4 weeks"
                  className={INPUT}
                />
              </div>
            )}

            {impacts.customer_impact && (
              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Customer Impact Details</label>
                <input
                  type="text"
                  value={customerImpactDetail}
                  onChange={(e) => setCustomerImpactDetail(e.target.value)}
                  placeholder="e.g. PPAP approval required by OEM before line trials"
                  className={INPUT}
                />
              </div>
            )}

            {impacts.contract_impact && (
              <div className={FIELD_CONTAINER}>
                <label className={LABEL}>Contract Impact Details</label>
                <input
                  type="text"
                  value={contractImpactDetail}
                  onChange={(e) => setContractImpactDetail(e.target.value)}
                  placeholder="e.g. Master Supply Agreement amendment needed for revised warranty clause"
                  className={INPUT}
                />
              </div>
            )}
          </div>
          <StepNavigation
            currentStep={3}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 5. Supplier Requirement */}
        <section id="supplier-impact" className={`${SECTION_CARD} ${currentStep === 4 ? "" : "hidden"}`}>
          <SectionHeading
            number={5}
            title="Supplier Impact"
            description="Capture supplier involvement and response requirements for this change."
          />

          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center gap-4">
              <label className={LABEL}>Supplier Required *</label>
              <div className="inline-flex rounded-lg border border-neutral-300 bg-neutral-50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => handleSupplierRequiredChange("No")}
                  aria-pressed={form.supplier_response_required === "No"}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    form.supplier_response_required === "No"
                      ? "bg-white text-neutral-900 shadow-xs"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => handleSupplierRequiredChange("Yes")}
                  aria-pressed={form.supplier_response_required === "Yes"}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    form.supplier_response_required === "Yes"
                      ? "bg-primary-600 text-white shadow-xs"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  Yes
                </button>
              </div>
            </div>

            {form.supplier_response_required === "Yes" ? (
              <dl className="grid grid-cols-1 gap-2 rounded-lg border border-primary-100 bg-primary-50/40 p-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] font-semibold uppercase text-neutral-500">Supplier Required</dt>
                  <dd className="mt-0.5 font-bold text-primary-800">Yes</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase text-neutral-500">RFQ</dt>
                  <dd className="mt-0.5 font-bold text-primary-800">Required</dd>
                </div>
              </dl>
            ) : null}

            {form.supplier_response_required === "Yes" && (
              <div className="space-y-4 border-t border-neutral-100 pt-4">
                <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/40 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-800">Procurement Reference</h3>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      Link an existing supplier document, or choose None for the standard ECR path.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <div className={FIELD_CONTAINER}>
                      <label htmlFor="ecr-supplier" className={LABEL}>Supplier *</label>
                      <ECRMasterDataPicker
                        kind="supplier"
                        value={form.suggested_supplier || ""}
                        onChange={(value, selected) =>
                          handleSupplierChange(value, Boolean(selected))
                        }
                        placeholder="Search supplier..."
                        error={errors.suggested_supplier}
                        valid={validReferences.suggested_supplier}
                        inputClassName={INPUT}
                        inputId="ecr-supplier"
                        selectionOnly
                      />
                    </div>

                    <div className={FIELD_CONTAINER}>
                      <label className={LABEL}>Reference Type *</label>
                      <select
                        value={procurementReferenceType}
                        onChange={(event) =>
                          handleReferenceTypeChange(
                            event.target.value as ECRProcurementReferenceType,
                          )
                        }
                        disabled={!supplierId}
                        className={`${SELECT} disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500`}
                      >
                        <option value="None">None</option>
                        <option value="RFQ">RFQ</option>
                      </select>
                    </div>

                    {procurementReferenceType === "RFQ" ? (
                      <div className={`${FIELD_CONTAINER} sm:col-span-2`}>
                        <label htmlFor="ecr-existing-rfq" className={LABEL}>RFQ *</label>
                        <ECRProcurementDocumentPicker
                          value={form.existing_rfq_reference || ""}
                          options={supplierRfqsQuery.data || []}
                          onChange={(value, selected) =>
                            handleSourceDocumentChange(value, Boolean(selected))
                          }
                          placeholder="Search supplier RFQs..."
                          emptyMessage="No RFQs found for this supplier."
                          loading={supplierRfqsQuery.isLoading}
                          loadError={supplierRfqsQuery.isError}
                          error={errors.existing_rfq_reference}
                          disabled={!supplierId}
                          inputClassName={INPUT}
                          inputId="ecr-existing-rfq"
                        />
                      </div>
                    ) : null}

                  </div>

                  {procurementReferenceType !== "None" && selectedSourceDocument ? (
                    <div className="space-y-2 border-t border-neutral-200 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className={LABEL}>Affected Items / Parts *</label>
                        <span className="text-[10px] font-medium text-neutral-500">
                          {(sourceItemsQuery.data || []).filter((item) =>
                            parts.some((part) => part.source_item_reference === item.sourceItemReference)
                          ).length} selected
                        </span>
                      </div>

                      {sourceItemsQuery.isLoading ? (
                        <div className="flex min-h-20 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white text-xs text-neutral-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading items…
                        </div>
                      ) : sourceItemsQuery.isError ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">
                          Unable to load items from the selected {procurementReferenceType}.
                        </div>
                      ) : (sourceItemsQuery.data?.length ?? 0) === 0 ? (
                        <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-4 text-center text-xs text-neutral-500">
                          No items found in this {procurementReferenceType === "RFQ" ? "RFQ" : "purchase order"}.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                          <table className="min-w-[620px] w-full text-left text-xs text-neutral-700">
                            <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                              <tr>
                                <th className="w-10 px-3 py-2">Select</th>
                                <th className="px-3 py-2">Item Code</th>
                                <th className="px-3 py-2">Description</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2">UOM</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                              {sourceItemsQuery.data?.map((item) => {
                                const selected = parts.some(
                                  (part) => part.source_item_reference === item.sourceItemReference,
                                );
                                return (
                                  <tr key={item.sourceItemReference} className={selected ? "bg-primary-50/50" : "hover:bg-neutral-50"}>
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggleSourceItem(item)}
                                        aria-label={`Select ${item.itemCode}`}
                                        className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                      />
                                    </td>
                                    <td className="px-3 py-2 font-mono font-semibold text-primary-700">{item.itemCode}</td>
                                    <td className="max-w-sm px-3 py-2 text-neutral-600">{item.description || "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                                    <td className="px-3 py-2">{item.uom}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {errors.procurement_items ? (
                        <span className={ERROR}>{errors.procurement_items}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Supplier Response Type</label>
                    <select
                      value={form.supplier_response_type}
                      onChange={f("supplier_response_type")}
                      className={SELECT}
                    >
                      <option value="Quotation">Quotation</option>
                      <option value="Feasibility">Feasibility</option>
                      <option value="Tooling">Tooling</option>
                      <option value="Capacity">Capacity</option>
                      <option value="Lead Time">Lead Time</option>
                      <option value="Quality Validation">Quality Validation</option>
                      <option value="Technical Compliance">Technical Compliance</option>
                      <option value="Commercial + Technical">Commercial + Technical</option>
                      <option value="Full Response">Full Response</option>
                      <option value="New Part Quotation">New Part Quotation</option>
                      <option value="Tooling Quotation">Tooling Quotation</option>
                      <option value="Feasibility Study">Feasibility Study</option>
                      <option value="Prototype">Prototype</option>
                      <option value="PPAP Submission">PPAP Submission</option>
                    </select>
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Required Qty</label>
                    <input
                      type="number"
                      value={form.required_quantity ?? 1}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, required_quantity: Number(e.target.value) }))
                      }
                      className={INPUT}
                    />
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>UOM</label>
                    <input
                      type="text"
                      value={form.quantity_uom}
                      onChange={f("quantity_uom")}
                      placeholder="Nos, kg, pcs"
                      className={INPUT}
                    />
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Technical Requirements</label>
                    <textarea
                      rows={2}
                      value={techRequirements}
                      onChange={(e) => setTechRequirements(e.target.value)}
                      placeholder="Material grade, tensile strength, surface treatment specs..."
                      className={TEXTAREA}
                    />
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Commercial Requirements</label>
                    <textarea
                      rows={2}
                      value={commRequirements}
                      onChange={(e) => setCommRequirements(e.target.value)}
                      placeholder="Target piece price, tooling amortization terms..."
                      className={TEXTAREA}
                    />
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Delivery Requirements</label>
                    <textarea
                      rows={2}
                      value={deliveryRequirements}
                      onChange={(e) => setDeliveryRequirements(e.target.value)}
                      placeholder="Sample delivery deadline, serial ramp-up date..."
                      className={TEXTAREA}
                    />
                  </div>

                  <div className={FIELD_CONTAINER}>
                    <label className={LABEL}>Quality Requirements</label>
                    <textarea
                      rows={2}
                      value={qualityRequirements}
                      onChange={(e) => setQualityRequirements(e.target.value)}
                      placeholder="PPAP Level 3, Cpk >= 1.67, 100% optical inspection..."
                      className={TEXTAREA}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <StepNavigation
            currentStep={4}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 6. Engineering Documents */}
        <section id="documents" className={`${SECTION_CARD} ${currentStep === 5 ? "" : "hidden"}`}>
          <SectionHeading
            number={6}
            title="Documents"
            description="Attach controlled drawings, 3D models, specifications and supporting evidence."
          />

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <DocumentUpload
              id="ecr-engineering-drawing"
              label="Drawing"
              accept=".pdf,.dwg,.dxf,image/*"
              savedValue={drawingFile}
              pendingFile={pendingDocuments.engineering_drawing}
              isUploading={createMutation.isPending}
              onSelect={(file) => selectDocument("engineering_drawing", file)}
              onRemove={() => removeDocument("engineering_drawing")}
            />
            <DocumentUpload
              id="ecr-cad-model"
              label="CAD / 3D Model"
              accept=".step,.stp,.iges,.igs,.stl,.zip"
              savedValue={cadFile}
              pendingFile={pendingDocuments["3d_cad_file"]}
              isUploading={createMutation.isPending}
              onSelect={(file) => selectDocument("3d_cad_file", file)}
              onRemove={() => removeDocument("3d_cad_file")}
            />
            <DocumentUpload
              id="ecr-specification"
              label="Specification Document"
              accept=".pdf,.doc,.docx,.xls,.xlsx"
              savedValue={specFile}
              pendingFile={pendingDocuments.specification}
              isUploading={createMutation.isPending}
              onSelect={(file) => selectDocument("specification", file)}
              onRemove={() => removeDocument("specification")}
            />
            <DocumentUpload
              id="ecr-supporting-documents"
              label="Supporting Documents"
              savedValue={supportingDocs}
              pendingFile={pendingDocuments.supporting_documents}
              isUploading={createMutation.isPending}
              onSelect={(file) => selectDocument("supporting_documents", file)}
              onRemove={() => removeDocument("supporting_documents")}
            />
          </div>
          <StepNavigation
            currentStep={5}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 7. Simplified demo workflow preview */}
        <section id="approval" className={`${SECTION_CARD} ${currentStep === 6 ? "" : "hidden"}`}>
          <SectionHeading
            number={7}
            title="ECR Workflow"
            description="Engineering approval is followed by Procurement Team review and Procurement Manager RFQ creation."
          />

          <ol className="flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-0">
            {[
              { role: "Draft", tag: "Engineer creates and submits" },
              { role: "Engineering Review", tag: "Engineering Manager approval" },
              { role: "Procurement Review", tag: "Procurement Team approval" },
              { role: "RFQ Pending", tag: "Procurement Manager action" },
              { role: "RFQ", tag: "RFQ created" },
            ].map((gate, index, steps) => (
              <li key={gate.role} className="flex min-w-0 flex-1 sm:items-center">
                <div className={`flex min-h-16 w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 ${index === 0 ? "border-primary-200 bg-primary-50/60" : "border-neutral-200 bg-neutral-50/60"}`}>
                  <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[10px] font-bold ${index === 0 ? "border-primary-500 bg-primary-600 text-white" : "border-neutral-300 bg-white text-neutral-500"}`}>
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold leading-4 text-neutral-800 truncate">{gate.role}</p>
                    <p className="text-[10px] text-neutral-500 truncate">{gate.tag}</p>
                  </div>
                </div>
                {index < steps.length - 1 ? (
                  <ChevronRight className="mx-0.5 hidden h-3.5 w-3.5 flex-none text-neutral-300 sm:block" />
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-neutral-500">
            Each downstream task is created only after the preceding review or action is completed.
          </p>
          <StepNavigation
            currentStep={6}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

        {/* 8. Procurement Traceability */}
        <section id="procurement" className={`${SECTION_CARD} ${currentStep === 7 ? "" : "hidden"}`}>
          <SectionHeading
            number={8}
            title="Procurement"
            description="Review the sequential Procurement Team approval and Procurement Manager RFQ handoff."
            aside={<span className="hidden rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-semibold text-neutral-500 sm:block">Read only</span>}
          />

          <p className="text-xs text-neutral-500">
            The Procurement Team approves the sourcing requirements before the Procurement Manager creates the RFQ. A Purchase Requisition is not required in this demo flow.
          </p>

          {form.supplier_response_required === "Yes" ? (
            <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-800">
                Existing Procurement Reference
              </p>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-[10px] font-medium text-neutral-500">Supplier</dt>
                  <dd className="mt-0.5 font-semibold text-neutral-800">{form.suggested_supplier || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium text-neutral-500">Reference Type</dt>
                  <dd className="mt-0.5 font-semibold text-neutral-800">{procurementReferenceType}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium text-neutral-500">Existing Document</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-neutral-800">{selectedSourceDocument || "—"}</dd>
                </div>
              </dl>
              <div className="mt-2 border-t border-primary-100 pt-2 text-[11px] text-neutral-600">
                <span className="font-medium">Affected items: </span>
                {parts.map((part) => part.partitem).filter(Boolean).join(", ") || "—"}
              </div>
            </div>
          ) : null}

          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Simplified Procurement Flow</p>

          <ol className="flex flex-col lg:flex-row lg:items-stretch">
            {procurementTraceability.map((item, index) => (
              <li key={item.label} className="flex min-w-0 flex-1 flex-col lg:flex-row lg:items-center">
                <div className="flex min-h-[72px] w-full min-w-0 flex-col justify-center rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2.5">
                  <span className="text-[11px] font-semibold text-neutral-700">{item.label}</span>
                  <span className="mt-1 text-[11px] font-medium text-neutral-600">{item.status}</span>
                  {item.reference ? (
                    <span className="mt-0.5 truncate font-mono text-[10px] text-neutral-500" title={item.reference}>
                      {item.reference}
                    </span>
                  ) : null}
                </div>
                {index < procurementTraceability.length - 1 ? (
                  <>
                    <ArrowDown className="mx-auto my-1 h-3.5 w-3.5 flex-none text-neutral-300 lg:hidden" />
                    <ChevronRight className="mx-1 hidden h-3.5 w-3.5 flex-none text-neutral-300 lg:block" />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          <StepNavigation
            currentStep={7}
            onStepChange={goToStep}
            onSaveDraft={() => void handleSave(false)}
            isSavingDraft={isSavingDraft}
            saveDraftLabel={saveDraftLabel}
            onSubmit={() => void handleSave(true)}
            isSubmitting={isSubmitting}
            submitLabel={submitLabel}
            isBusy={isBusy}
          />
        </section>

      </form>
      )}
    </div>
  );
}
