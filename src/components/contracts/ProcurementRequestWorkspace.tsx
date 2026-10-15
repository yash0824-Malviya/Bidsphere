import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  clmError,
  clmRecordRoute,
  clmViewerKey,
  createRfqContractRequest,
  getClmDetail,
  getClmMetadata,
  getDesignatedLegalSignatory,
  getRfqClmSummary,
  saveRfqRequestDraft,
  submitRfqClmRequest,
  type ClmDetail,
  type ClmField,
  type RfqClmSummary,
  type LegalSignatoryResolution,
} from "../../api/clm";
import { getSupplierQuotation } from "../../api/sourcing";
import type { SQItem } from "../../types/erpnext";
import { canPrepareRfqContract } from "../../utils/rfqContractPermissions";
import { canAccessPath, normalizeAppRole } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { RFQ_CONTRACT_TYPES, validateRfqContractDetails } from "../../utils/rfqContractContext";
import { rfqClmRequestWorkflowView, rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";
import ClmFields, { CLM_BUTTON, CLM_PRIMARY } from "./ClmFields";
import { RfqSourceDocuments } from "./ClmSourceTraceability";
import { contractSourceDocuments } from "./ClmDocuments";
import ContractWorkflowStepper from "./ContractWorkflowStepper";
import ContractPdfPreviewModal, { type ContractPreviewDocument } from "./ContractPdfPreviewModal";
import { uploadFileToERPNextDetailed } from "../../api/legalDocsStorage";

const termFields: ClmField[] = [
  { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
  { fieldname: "contract_purpose", label: "Contract Purpose", fieldtype: "Small Text" },
  { fieldname: "description", label: "Contract Description", fieldtype: "Small Text" },
  { fieldname: "contract_start_date", label: "Contract Start Date", fieldtype: "Date" },
  { fieldname: "contract_end_date", label: "Contract End Date", fieldtype: "Date" },
  { fieldname: "contract_value", label: "Contract Value", fieldtype: "Currency" },
  { fieldname: "currency", label: "Currency", fieldtype: "Link", options: "Currency" },
  { fieldname: "estimated_contract_value", label: "Estimated Contract Value", fieldtype: "Currency" },
];
const termNames = termFields.map(field => field.fieldname);
const reviewLabels: Record<string, string> = {
  custom_inteva_signatory: "Legal Manager Signatory",
};
const defaultReviewFields: ClmField[] = [
  { fieldname: "custom_inteva_signatory", label: "Legal Manager Signatory", fieldtype: "Link", options: "User", reqd: 1 },
];
const string = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());
const terms = (record: Record<string, unknown>) => Object.fromEntries(termNames.map(name => [name, record[name] ?? ""]));
const hasValue = (value: unknown) => value !== undefined && value !== null && string(value) !== "";

export interface ContractTypeConfig {
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  documentTitle: string;
  documentBadge: string;
  documentHelp: string;
  showAwardedItems: boolean;
  showCommercialAmounts: boolean;
  showProcurementDelivery: boolean;
}

export const CONTRACT_TYPE_CONFIG: Record<string, ContractTypeConfig> = {
  "Supply / Procurement Contract": {
    title: "Supply / Procurement Contract",
    description: "Physical goods procurement with itemized pricing, delivery schedule, warranty, and inspection terms.",
    badge: "Supply / Goods",
    badgeColor: "bg-blue-50 text-blue-800 border-blue-200",
    documentTitle: "Supply Agreement Document",
    documentBadge: "Supply Contract PDF",
    documentHelp: "Attach the signed or draft supply contract PDF. Accompanies the contract into Legal Review.",
    showAwardedItems: true,
    showCommercialAmounts: true,
    showProcurementDelivery: true,
  },
  "Service Agreement": {
    title: "Service Agreement",
    description: "Professional and technical services with defined deliverables, milestones, SLAs, and performance KPIs.",
    badge: "Services & SOW",
    badgeColor: "bg-purple-50 text-purple-800 border-purple-200",
    documentTitle: "Service Agreement & SOW Document",
    documentBadge: "Service Agreement PDF",
    documentHelp: "Attach the master service agreement or Statement of Work (SOW). Accompanies the contract into Legal Review.",
    showAwardedItems: false,
    showCommercialAmounts: true,
    showProcurementDelivery: false,
  },
  "NDA": {
    title: "Non-Disclosure Agreement (NDA)",
    description: "Confidentiality and proprietary information protection agreement with scope, disclosure terms, and governing law.",
    badge: "Confidentiality (NDA)",
    badgeColor: "bg-indigo-50 text-indigo-800 border-indigo-200",
    documentTitle: "Non-Disclosure Agreement Document",
    documentBadge: "NDA Document PDF",
    documentHelp: "Attach the executed or draft NDA document. Accompanies the contract into Legal Review.",
    showAwardedItems: false,
    showCommercialAmounts: false,
    showProcurementDelivery: false,
  },
  "Master Service Agreement": {
    title: "Master Service Agreement (MSA)",
    description: "Framework agreement governing overarching commercial terms, multi-SOW relationships, and legal covenants.",
    badge: "Master Framework",
    badgeColor: "bg-teal-50 text-teal-800 border-teal-200",
    documentTitle: "Master Service Agreement (MSA) Document",
    documentBadge: "MSA Document PDF",
    documentHelp: "Attach the signed or draft MSA framework document. Accompanies the contract into Legal Review.",
    showAwardedItems: false,
    showCommercialAmounts: true,
    showProcurementDelivery: false,
  },
  "Other": {
    title: "Other / Custom Contract",
    description: "Custom contractual agreement tailored to bespoke commercial and operational requirements.",
    badge: "Custom Agreement",
    badgeColor: "bg-slate-100 text-slate-800 border-slate-200",
    documentTitle: "Contract Document & Attachments",
    documentBadge: "Contract Document",
    documentHelp: "Attach the agreement draft or supporting agreement files. Accompanies the contract into Legal Review.",
    showAwardedItems: false,
    showCommercialAmounts: true,
    showProcurementDelivery: false,
  },
};

export function getTermFieldsForType(type: string): ClmField[] {
  const normType = type || "Supply / Procurement Contract";
  if (normType === "NDA") {
    return [
      { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
      { fieldname: "contract_purpose", label: "Purpose of Disclosure", fieldtype: "Small Text" },
      { fieldname: "description", label: "Confidentiality Scope & Description", fieldtype: "Small Text" },
      { fieldname: "contract_start_date", label: "Effective Date", fieldtype: "Date" },
      { fieldname: "contract_end_date", label: "Expiration Date / Duration", fieldtype: "Date" },
    ];
  }
  if (normType === "Service Agreement") {
    return [
      { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
      { fieldname: "contract_purpose", label: "Service Scope & Deliverables", fieldtype: "Small Text" },
      { fieldname: "description", label: "Deliverables Description & Task Milestones", fieldtype: "Small Text" },
      { fieldname: "contract_start_date", label: "Service Start Date", fieldtype: "Date" },
      { fieldname: "contract_end_date", label: "Service End Date", fieldtype: "Date" },
      { fieldname: "contract_value", label: "Contract Value", fieldtype: "Currency" },
      { fieldname: "currency", label: "Currency", fieldtype: "Link", options: "Currency" },
      { fieldname: "estimated_contract_value", label: "Estimated Contract Value", fieldtype: "Currency" },
    ];
  }
  if (normType === "Master Service Agreement") {
    return [
      { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
      { fieldname: "contract_purpose", label: "Agreement Scope & Master Objectives", fieldtype: "Small Text" },
      { fieldname: "description", label: "Framework Scope & Operational Terms", fieldtype: "Small Text" },
      { fieldname: "contract_start_date", label: "Effective Date", fieldtype: "Date" },
      { fieldname: "contract_end_date", label: "Expiration Date", fieldtype: "Date" },
      { fieldname: "contract_value", label: "Contract Value", fieldtype: "Currency" },
      { fieldname: "currency", label: "Currency", fieldtype: "Link", options: "Currency" },
      { fieldname: "estimated_contract_value", label: "Estimated Contract Value", fieldtype: "Currency" },
    ];
  }
  if (normType === "Other") {
    return [
      { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
      { fieldname: "contract_purpose", label: "Contract Purpose", fieldtype: "Small Text" },
      { fieldname: "description", label: "Contract Description", fieldtype: "Small Text" },
      { fieldname: "contract_start_date", label: "Effective Start Date", fieldtype: "Date" },
      { fieldname: "contract_end_date", label: "Effective End Date", fieldtype: "Date" },
      { fieldname: "contract_value", label: "Contract Value", fieldtype: "Currency" },
      { fieldname: "currency", label: "Currency", fieldtype: "Link", options: "Currency" },
      { fieldname: "estimated_contract_value", label: "Estimated Contract Value", fieldtype: "Currency" },
    ];
  }
  return [
    { fieldname: "contract_type", label: "Contract Type", fieldtype: "Select", options: RFQ_CONTRACT_TYPES.join("\n") },
    { fieldname: "contract_purpose", label: "Contract Purpose & Supply Objective", fieldtype: "Small Text" },
    { fieldname: "description", label: "Contract Description & Special Terms", fieldtype: "Small Text" },
    { fieldname: "contract_start_date", label: "Contract Start Date", fieldtype: "Date" },
    { fieldname: "contract_end_date", label: "Contract End Date", fieldtype: "Date" },
    { fieldname: "contract_value", label: "Contract Value", fieldtype: "Currency" },
    { fieldname: "currency", label: "Currency", fieldtype: "Link", options: "Currency" },
    { fieldname: "estimated_contract_value", label: "Estimated Contract Value", fieldtype: "Currency" },
  ];
}

/** The summary API resolves the RFQ's persisted award; draft/quotation values cannot override it. */
function withAwardValues(values: Record<string, unknown>, summary: RfqClmSummary | undefined): Record<string, unknown> {
  const source = summary?.source?.award ? summary.source : undefined;
  return {
    ...values,
    contract_value: source?.amount ?? "",
    currency: source?.currency ?? "",
    ...(hasValue(source?.approved_estimated_value) ? { estimated_contract_value: source!.approved_estimated_value } : {}),
  };
}

/** Validate entered terms against the saved award without replacing the user's draft. */
export function procurementRequestCreateErrors(
  values: Record<string, unknown>,
  summary: RfqClmSummary | undefined,
  options?: {
    payment_terms?: string;
    delivery_terms?: string;
    extraTerms?: Record<string, string>;
  }
): Record<string, string> {
  const errors = validateRfqContractDetails(values);
  const type = string(values.contract_type) || "Supply / Procurement Contract";

  if (!summary?.source?.award) errors.award = "A saved supplier award is required before Contract creation.";
  if (!string(summary?.prefill.supplier)) errors.supplier = "A winning supplier is required before Contract creation.";
  if (!string(summary?.prefill.custom_supplier_quotation)) errors.quotation = "A winning supplier quotation is required before Contract creation.";
  if (summary?.contract_required !== "Yes" || summary.decision !== "Yes") errors.contract_required = "Contract Required must be Yes on the saved RFQ.";

  // Commercial amounts are mandatory for all types except pure confidentiality (NDA)
  if (type !== "NDA") {
    for (const field of ["contract_value", "estimated_contract_value"]) {
      const label = field === "contract_value" ? "Contract Value" : "Estimated Contract Value";
      if (!hasValue(values[field]) || !Number.isFinite(Number(values[field])) || Number(values[field]) < 0) {
        errors[field] = `${label} must be a valid non-negative amount.`;
      } else if (
        (field === "contract_value" || summary?.locked_fields.includes(field)) &&
        hasValue(summary?.prefill[field]) &&
        Number(values[field]) !== Number(summary?.prefill[field])
      ) {
        errors[field] =
          field === "contract_value"
            ? `Contract Value must match the saved award amount (${string(summary?.prefill.currency)} ${string(summary?.prefill[field])}).`
            : `Estimated Contract Value must match the approved estimate (${string(summary?.prefill.currency)} ${string(summary?.prefill[field])}).`;
      }
    }
    if (!string(values.currency)) errors.currency = "Currency is required.";
    else if (string(summary?.prefill.currency) && string(values.currency) !== string(summary?.prefill.currency)) {
      errors.currency = `Currency must match the saved award (${string(summary?.prefill.currency)}).`;
    }
  }

  if (!string(values.custom_inteva_signatory)) errors.custom_inteva_signatory = "Legal Manager Signatory is required.";

  // Type-specific field validations
  const pt = options?.payment_terms !== undefined ? options.payment_terms : options?.extraTerms?.payment_terms;
  const dt = options?.delivery_terms !== undefined ? options.delivery_terms : options?.extraTerms?.delivery_terms;

  if (type === "Supply / Procurement Contract") {
    if (pt !== undefined && !string(pt)) errors.payment_terms = "Payment Terms are required.";
    if (dt !== undefined && !string(dt)) errors.delivery_terms = "Delivery Terms are required.";
  } else if (type === "Service Agreement") {
    if (pt !== undefined && !string(pt)) errors.payment_terms = "Payment Schedule / Payment Terms are required.";
  } else if (type === "NDA") {
    if (options?.extraTerms?.confidential_scope !== undefined && !string(options.extraTerms.confidential_scope)) {
      errors.confidential_scope = "Confidential Information Scope is required.";
    }
    if (options?.extraTerms?.disclosing_party !== undefined && !string(options.extraTerms.disclosing_party)) {
      errors.disclosing_party = "Disclosing Party is required.";
    }
    if (options?.extraTerms?.receiving_party !== undefined && !string(options.extraTerms.receiving_party)) {
      errors.receiving_party = "Receiving Party is required.";
    }
  } else if (type === "Master Service Agreement") {
    if (pt !== undefined && !string(pt)) errors.payment_terms = "Payment Framework is required.";
  } else if (type === "Other") {
    if (options?.extraTerms?.custom_title !== undefined && !string(options.extraTerms.custom_title)) {
      errors.custom_title = "Contract Title / Type Description is required.";
    }
  }

  return errors;
}

function Information({ label, value, error }: { label: string; value: unknown; error?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-900">
        {hasValue(value) ? string(value) : "—"}
      </dd>
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ProcurementRequestWorkspace({
  detail,
  onSaved,
}: {
  detail: ClmDetail;
  onSaved: (detail: ClmDetail) => void;
}) {
  const qc = useQueryClient();
  const rawRole = useAuthStore(state => state.user?.role);
  const role = normalizeAppRole(rawRole);
  const [saved, setSaved] = useState(detail);
  const [values, setValues] = useState<Record<string, unknown>>(() => terms(detail.record));
  const [extraTerms, setExtraTerms] = useState<Record<string, string>>(() => ({
    payment_terms: string(detail.record.payment_terms || detail.record.custom_payment_terms) || "Net 30",
    delivery_terms: string(detail.record.delivery_terms || detail.record.custom_delivery_terms) || "DAP - Delivered at Place",
    inspection_terms: "Standard inspection upon delivery within 48 hours; acceptance subject to QA verification.",
    warranty_terms: "12-month standard manufacturer warranty from date of acceptance.",
    penalties: "0.5% per week of delay up to a maximum of 5% of order value.",
    sla_terms: "99.5% service availability during standard business hours; 4-hour response time.",
    performance_kpis: "On-time delivery >= 98%, First-time fix rate >= 95%.",
    renewal_terms: "Annual renewal upon mutual written agreement 60 days prior to contract expiration.",
    termination_terms: "30 days prior written notice for convenience; immediate termination upon material breach.",
    governing_law: "State of Delaware, United States",
    disclosing_party: string(detail.record.company) || "Netlink",
    receiving_party: string(detail.record.supplier) || "",
    confidential_scope: "All proprietary technical data, engineering specifications, rates, and commercial terms disclosed under RFQ.",
    confidentiality_obligations: "Strict confidentiality for 3 years; disclose only on a need-to-know basis.",
    permitted_disclosures: "To authorized employees, legal counsel, and financial auditors under equivalent NDA obligations.",
    custom_title: "",
  }));
  const [reviews, setReviews] = useState<Record<string, unknown>>(() => ({
    custom_inteva_signatory: string(detail.record.custom_inteva_signatory),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "create" | "upload" | "">("");
  const [createdContract, setCreatedContract] = useState("");
  const working = useRef(false);
  const dirty = useRef(false);

  // File upload & PDF preview state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    size: number;
    url?: string;
    bytes?: Uint8Array;
  } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<ContractPreviewDocument | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (detail.record.name !== saved.record.name || !dirty.current) {
      setSaved(detail);
      setValues(terms(detail.record));
      setReviews(prev => ({
        custom_inteva_signatory: string(detail.record.custom_inteva_signatory) || prev.custom_inteva_signatory,
      }));
    }
    if (detail.record.name !== saved.record.name) {
      dirty.current = false;
      setErrors({});
      setError("");
      setNotice("");
      setCreatedContract("");
      setReviews({
        custom_inteva_signatory: string(detail.record.custom_inteva_signatory),
      });
      setExtraTerms(prev => ({
        ...prev,
        payment_terms: string(detail.record.payment_terms || detail.record.custom_payment_terms) || "Net 30",
        delivery_terms: string(detail.record.delivery_terms || detail.record.custom_delivery_terms) || "DAP - Delivered at Place",
        disclosing_party: string(detail.record.company) || "Netlink",
        receiving_party: string(detail.record.supplier) || "",
      }));
      setAttachedFile(null);
    }
  }, [detail]);

  const record = saved.record;
  const rfq = string(record.custom_rfq);
  const workflow = rfqClmRequestWorkflowView(record);
  const summaryKey = ["clm", "rfq-contract", rfq, clmViewerKey()];
  const query = useQuery({ queryKey: summaryKey, queryFn: () => getRfqClmSummary(rfq), enabled: !!rfq, staleTime: 15_000 });
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const legalSignatoryQuery = useQuery({
    queryKey: ["clm", "legal-signatory", clmViewerKey()],
    queryFn: getDesignatedLegalSignatory,
    staleTime: 60_000,
  });
  const context = query.data;
  const legalResolution: LegalSignatoryResolution | undefined = context?.designated_legal_signatory || legalSignatoryQuery.data;
  const canReassign = ["procurement manager", "purchase manager"].includes(String(rawRole || "").trim().toLowerCase()) || role === "admin";
  const [adminEditingAssignee, setAdminEditingAssignee] = useState(false);
  const matches = !!context && context.rfq.name === rfq && context.request?.name === record.name;
  const displayedValues = withAwardValues(values, matches ? context : undefined);

  // Determine active contract type configuration
  const currentContractType = string(values.contract_type) || "Supply / Procurement Contract";
  const typeConfig = CONTRACT_TYPE_CONFIG[currentContractType] || CONTRACT_TYPE_CONFIG["Supply / Procurement Contract"];
  const dynamicTermFields = getTermFieldsForType(string(values.contract_type));
  const dynamicTermNames = dynamicTermFields.map(field => field.fieldname);

  const readOnlyTerms = [
    "contract_value",
    "currency",
    ...(matches && hasValue(context?.source?.approved_estimated_value) ? ["estimated_contract_value"] : []),
  ];
  const existingContract = string(record.custom_contract) || createdContract || string(matches ? context?.contract?.name : "");
  const resuming = matches && context?.recovery_required === true;
  const contractQuery = useQuery({
    queryKey: ["clm", "detail", "Contract", existingContract, false, clmViewerKey()],
    queryFn: () => getClmDetail("Contract", existingContract),
    enabled: !!existingContract && !resuming && (context?.can_open_contract === true || !!createdContract),
    staleTime: 15_000,
  });

  useEffect(() => {
    const existingSignatory = string(contractQuery.data?.record?.custom_inteva_signatory || record.custom_inteva_signatory);
    setReviews(prev => {
      let nextSig = existingSignatory || prev.custom_inteva_signatory;
      if (!nextSig && legalResolution?.signatory?.name) {
        nextSig = legalResolution.signatory.name;
      }
      if (nextSig === prev.custom_inteva_signatory) return prev;
      return {
        ...prev,
        custom_inteva_signatory: nextSig,
      };
    });
  }, [contractQuery.data?.record?.custom_inteva_signatory, record.custom_inteva_signatory, legalResolution?.signatory?.name]);

  const assignedSignatory = string(reviews.custom_inteva_signatory);
  const assignedUser = legalResolution?.eligible_signatories?.find(
    u => u.name.toLowerCase() === assignedSignatory.toLowerCase() || u.email.toLowerCase() === assignedSignatory.toLowerCase()
  ) || (legalResolution?.signatory && legalResolution.signatory.name.toLowerCase() === assignedSignatory.toLowerCase() ? legalResolution.signatory : undefined);
  const assignedName = assignedUser?.full_name || assignedUser?.name || assignedSignatory;
  const assignedEmail = assignedUser?.email || assignedSignatory;
  const contractWorkflow = contractQuery.data ? rfqClmWorkflowView(contractQuery.data.record) : undefined;
  const handedOff = !!existingContract && !resuming && (!!createdContract || (matches && context?.contract?.name === existingContract));
  const editable = canPrepareRfqContract(rawRole) && saved.rfq_request_draft_editable === true && !existingContract;
  const canCreate = canPrepareRfqContract(rawRole) && (!existingContract || resuming) && (editable || (matches && !!context?.can_create));
  const contractFieldsFromMeta = metadata.data?.fields.Contract || [];
  const reviewFields = defaultReviewFields.map(fallback => {
    const fromMeta = contractFieldsFromMeta.find(f => f.fieldname === fallback.fieldname);
    return fromMeta ? { ...fromMeta, label: reviewLabels[fromMeta.fieldname] || fromMeta.label, reqd: 1 } : fallback;
  });
  const missingReviewFields: string[] = [];
  const supplier = string(matches ? context?.prefill.supplier || workflow?.supplier : workflow?.supplier || record.supplier);
  const award = string(matches ? context?.source?.award || workflow?.award : workflow?.award);
  const winningQuotation = string(
    matches
      ? context?.prefill.custom_supplier_quotation || context?.source?.quotation
      : record.custom_supplier_quotation
  );

  // Prefill awarded item rows from the winning Supplier Quotation
  const sqQuery = useQuery({
    queryKey: ["sourcing", "supplier-quotation", winningQuotation],
    queryFn: () => getSupplierQuotation(winningQuotation),
    enabled: !!winningQuotation,
    staleTime: 30_000,
  });

  const awardedItems: SQItem[] = (
    sqQuery.data?.items ||
    ((record as Record<string, unknown>).items as SQItem[]) ||
    []
  );

  // Sync quotation payment / delivery terms and receiving party
  useEffect(() => {
    if (sqQuery.data) {
      const sqPayment = string(
        sqQuery.data.payment_terms_template ||
        sqQuery.data.payment_terms ||
        (sqQuery.data as Record<string, unknown>).terms
      );
      const sqDelivery = string(
        sqQuery.data.delivery_terms ||
        (sqQuery.data as Record<string, unknown>).incoterm
      );
      setExtraTerms(prev => ({
        ...prev,
        ...(sqPayment && (!prev.payment_terms || prev.payment_terms === "Net 30") ? { payment_terms: sqPayment } : {}),
        ...(sqDelivery && (!prev.delivery_terms || prev.delivery_terms === "DAP - Delivered at Place") ? { delivery_terms: sqDelivery } : {}),
        ...(supplier && !prev.receiving_party ? { receiving_party: supplier } : {}),
      }));
    }
  }, [sqQuery.data, supplier]);

  const documents = [
    ...new Map(
      [...contractSourceDocuments(record), ...(matches ? context?.source_documents || [] : [])]
        .filter(document => {
          if (document.source_doctype === "Request for Quotation" && document.source_name !== rfq) return false;
          if (
            document.source_doctype === "Supplier Quotation" &&
            (/\bpo[_-]/i.test(document.file_name) || /\bpur[_-]ord\b/i.test(document.file_name) || /\bpurchase[_-]?order\b/i.test(document.file_name))
          ) {
            return false;
          }
          if (document.source_doctype === "Purchase Order") {
            const contractPo = string(record.custom_purchase_order || record.purchase_order || (matches ? context?.prefill.custom_purchase_order : ""));
            if (contractPo && document.source_name !== contractPo) return false;
          }
          return true;
        })
        .map(document => [
          document.file_id || document.file_url || `${document.source_doctype}-${document.source_name}-${document.file_name}`,
          document,
        ])
    ).values(),
  ];

  function handleContractTypeChange(newType: string) {
    dirty.current = true;
    setValues(prev => ({ ...prev, contract_type: newType }));
    // Reset only type-specific validation errors when the type changes
    setErrors(prev => {
      const copy = { ...prev };
      delete copy.contract_type;
      delete copy.payment_terms;
      delete copy.delivery_terms;
      delete copy.confidential_scope;
      delete copy.disclosing_party;
      delete copy.receiving_party;
      delete copy.custom_title;
      return copy;
    });
  }

  function updateExtraTerm(key: string, val: string) {
    dirty.current = true;
    setExtraTerms(prev => ({ ...prev, [key]: val }));
    if (errors[key]) {
      setErrors(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  }

  function refreshLists() {
    void qc.invalidateQueries({ queryKey: ["clm", "list"] });
    void qc.invalidateQueries({ queryKey: ["rfq", rfq] });
  }

  function acceptDetail(next: ClmDetail) {
    if (next.record.name !== record.name || next.record.custom_rfq !== rfq) {
      throw new Error("The contract service returned a different Request. Refresh before continuing.");
    }
    setSaved(next);
    dirty.current = false;
    setValues(terms(next.record));
    onSaved(next);
    refreshLists();
  }

  function assertContext(summary: RfqClmSummary) {
    if (summary.rfq.name !== rfq || summary.request?.name !== record.name) {
      throw new Error("The RFQ does not reference this Contract Request. Refresh before continuing.");
    }
  }

  async function saveDraft() {
    if (working.current || !editable) return;
    working.current = true;
    setBusy("save");
    setError("");
    setNotice("");
    setErrors({});
    try {
      const fresh = await getRfqClmSummary(rfq);
      assertContext(fresh);
      qc.setQueryData(summaryKey, fresh);
      const latestValues = withAwardValues(values, fresh);
      if (
        currentContractType !== "NDA" &&
        (!hasValue(latestValues.contract_value) ||
          !Number.isFinite(Number(latestValues.contract_value)) ||
          Number(latestValues.contract_value) < 0 ||
          !string(latestValues.currency))
      ) {
        throw new Error(
          fresh.reason ||
          "The saved supplier award amount and currency could not be verified. Retry loading the award."
        );
      }
      setValues(latestValues);
      const draftPayload = terms(latestValues);
      const result = await saveRfqRequestDraft({
        name: record.name,
        expected_modified: string(record.modified),
        payload: draftPayload,
      });
      acceptDetail(result);
      setNotice("Draft saved. The Request remains with Procurement Team.");
    } catch (cause) {
      setError(clmError(cause));
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  async function createContract() {
    if (working.current) return;
    if (!canCreate) {
      setError("Contract creation is only available for authorized users at this stage of the procurement workflow.");
      toast?.error?.("Contract creation is not available at this workflow stage.");
      return;
    }
    working.current = true;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      let fresh = await getRfqClmSummary(rfq);
      assertContext(fresh);
      qc.setQueryData(summaryKey, fresh);
      if (fresh.contract && !fresh.recovery_required) {
        setCreatedContract(fresh.contract.name);
        setNotice("Contract already exists.");
        return;
      }
      let latestValues = withAwardValues(values, fresh);
      setValues(latestValues);
      const nextErrors = procurementRequestCreateErrors(
        { ...latestValues, ...reviews },
        fresh,
        {
          payment_terms: extraTerms.payment_terms,
          delivery_terms: extraTerms.delivery_terms,
          extraTerms,
        }
      );
      if (missingReviewFields.length) {
        nextErrors.review = "Required Contract review fields are unavailable. Retry loading the Contract fields.";
      }
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        const errorList = Object.values(nextErrors);
        setError(`Please complete all required fields before creating the Contract:\n• ${errorList.join("\n• ")}`);
        toast?.error?.(`Please complete all required fields (${errorList.length} missing or invalid).`);
        return;
      }
      if (!(fresh.request_needs_details && fresh.can_request || fresh.can_create)) {
        throw new Error(fresh.reason || "This saved Request is not ready for Contract creation.");
      }
      if (editable) {
        acceptDetail(
          await saveRfqRequestDraft({
            name: record.name,
            expected_modified: string(record.modified),
            payload: terms(latestValues),
          })
        );
        fresh = await getRfqClmSummary(rfq);
        assertContext(fresh);
        qc.setQueryData(summaryKey, fresh);
        if (fresh.contract && !fresh.recovery_required) {
          setCreatedContract(fresh.contract.name);
          setNotice("Contract already exists.");
          return;
        }
        latestValues = withAwardValues(latestValues, fresh);
        setValues(latestValues);
        const changedErrors = procurementRequestCreateErrors(
          { ...latestValues, ...reviews },
          fresh,
          {
            payment_terms: extraTerms.payment_terms,
            delivery_terms: extraTerms.delivery_terms,
            extraTerms,
          }
        );
        setErrors(changedErrors);
        if (Object.keys(changedErrors).length) {
          const errorList = Object.values(changedErrors);
          setError(`Please complete all required fields before creating the Contract:\n• ${errorList.join("\n• ")}`);
          toast?.error?.(`Please complete all required fields (${errorList.length} missing or invalid).`);
          return;
        }
      }
      if (fresh.request_needs_details) {
        const prepared = await submitRfqClmRequest({
          rfq,
          expected_modified: fresh.rfq.modified,
          payload: terms(latestValues),
        });
        assertContext(prepared.summary);
        fresh = prepared.summary;
        qc.setQueryData(summaryKey, fresh);
        acceptDetail(await getClmDetail("Contract Request", record.name));
      }
      if (!fresh.can_create) {
        throw new Error(fresh.reason || "The saved Request is not ready for Contract creation.");
      }

      // Legal Review handoff review attributes for CLM creation
      const reviewPayload: Record<string, unknown> = {
        custom_inteva_signatory: string(reviews.custom_inteva_signatory),
      };

      const result = await createRfqContractRequest({
        rfq,
        expected_modified: fresh.rfq.modified,
        payload: {},
        contract_fields: reviewPayload,
      });
      assertContext(result.summary);
      const contract = result.summary.contract?.name;
      if (!contract || result.contract?.record.name !== contract || result.summary.recovery_required) {
        throw new Error("ERPNext did not confirm a complete linked Contract handoff. Refresh the Request before retrying.");
      }
      qc.setQueryData(summaryKey, result.summary);
      setCreatedContract(contract);
      refreshLists();
      acceptDetail(await getClmDetail("Contract Request", record.name));
      setNotice(result.created ? "Contract created and sent to Legal Review." : "Contract already exists.");
      toast.success(result.created ? "Contract created and sent to Legal Review." : "Contract already exists.");
    } catch (cause) {
      const msg = clmError(cause);
      setError(msg);
      toast?.error?.(msg);
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  // Handle local file selection
  async function handleFileSelected(file: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10 MB limit.");
      return;
    }
    const url = URL.createObjectURL(file);
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      bytes = undefined;
    }
    setAttachedFile({ name: file.name, size: file.size, url, bytes });

    // Proactively upload file to ERPNext if editable
    if (editable) {
      setBusy("upload");
      try {
        await uploadFileToERPNextDetailed(file, "Contract Request", record.name, { isPrivate: true });
        toast.success(`Attached "${file.name}" to this Contract Request.`);
      } catch {
        // Mock or network failure tolerated, file preview remains functional
      } finally {
        setBusy("");
      }
    }
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  const assignedRoleDisplay = handedOff
    ? contractWorkflow?.owner || "Loading Contract assignment…"
    : workflow?.owner || (resuming ? "Procurement Team" : "Procurement Team");

  return (
    <div className="min-w-0 space-y-5" aria-label="Procurement Contract Request workspace">
      {/* 1. BREADCRUMB & CONTRACT REQUEST HEADER */}
      <section
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs"
        aria-label="Request Header"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mb-1">
              <Link to="/contract-requests" className="hover:text-blue-700 transition-colors">
                Contract Requests
              </Link>
              <span aria-hidden="true" className="text-slate-400">/</span>
              <span className="font-mono font-semibold text-slate-700">{record.name}</span>
            </nav>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Contract Request &bull; <span className="font-mono text-blue-700">{record.name}</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${handedOff
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
                }`}
            >
              {handedOff ? "Contract Created" : workflow?.status || string(record.request_status) || "Pending Review"}
            </span>
            {resuming && (
              <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
                Recovery Required
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 2. COMPACT WORKFLOW STEPPER */}
      <ContractWorkflowStepper
        compact
        contractCreated={handedOff}
        phase={contractWorkflow?.stage || (handedOff ? "legal_review" : "draft")}
        status={handedOff ? "Pending Legal" : string(record.request_status)}
      />

      {/* 3. CURRENT ACTION PANEL */}
      {handedOff ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-950 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">
                  ✓
                </span>
                <h2 className="text-sm font-bold text-emerald-900">Contract Created Successfully</h2>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-emerald-800">
                Linked Contract: <strong className="font-mono">{existingContract}</strong>. The contract has been
                handed off to <strong className="font-semibold">Legal Review</strong>.
              </p>
            </div>
            {existingContract && (
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 transition-colors"
                to={clmRecordRoute("Contract", existingContract)}
              >
                <span>View Contract</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/70 p-4 sm:p-5 text-slate-800 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs shadow-2xs">
                  3
                </span>
                <h2 className="text-base font-bold text-blue-950">
                  Your next action — Procurement Team
                </h2>
              </div>
              <p className="mt-1.5 text-xs sm:text-sm text-slate-700 leading-relaxed">
                Review the approved supplier award, complete the required {typeConfig.title} details, attach the contract document if required, and create the Contract.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>
                  Current Status: <strong className="font-semibold text-slate-900">{workflow?.status || string(record.request_status) || "Pending Review"}</strong>
                </span>
                <span>
                  &bull; Assigned Role: <strong className="font-semibold text-slate-900">{assignedRoleDisplay}</strong>
                </span>
              </div>
            </div>
            {canCreate && !handedOff && (
              <button
                type="button"
                className={`${CLM_PRIMARY} shadow-xs shrink-0`}
                disabled={!!busy || query.isLoading || !matches}
                onClick={() => void createContract()}
              >
                {busy === "create" ? "Creating…" : resuming ? "Resume Contract creation" : "Create Contract"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. READ-ONLY RFQ & AWARD SUMMARY */}
      <section
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs"
        aria-label="Approved RFQ Award Summary"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              {currentContractType === "NDA" ? "Source RFQ & Contracting Parties" : "Approved RFQ & Award Summary"}
            </h2>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
              Read-Only
            </span>
          </div>
          {rfq && canAccessPath(role || "", `/sourcing/rfq/${encodeURIComponent(rfq)}`) && (
            <Link
              to={`/sourcing/rfq/${encodeURIComponent(rfq)}`}
              className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
            >
              <span>View Source RFQ</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          )}
        </div>

        <dl className="mt-3.5 grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <Information label={currentContractType === "Service Agreement" || currentContractType === "Master Service Agreement" ? "Service Provider / Supplier" : "Supplier"} value={supplier || "Pending Award"} error={errors.supplier} />
          <Information label="RFQ ID" value={rfq || "—"} />
          <Information label="Award ID" value={award || "Pending"} error={errors.award} />
          <Information
            label="Winning Quotation"
            value={winningQuotation || "Pending"}
            error={errors.quotation}
          />

          {/* Award value is shown for commercial contract types, hidden for pure NDA */}
          {typeConfig.showCommercialAmounts ? (
            <>
              <Information
                label="Award Value"
                value={
                  hasValue(displayedValues.contract_value)
                    ? `${string(displayedValues.currency)} ${Number(displayedValues.contract_value).toLocaleString()}`
                    : matches && hasValue(context?.prefill.contract_value)
                      ? `${string(context?.prefill.currency)} ${Number(context?.prefill.contract_value).toLocaleString()}`
                      : "—"
                }
                error={errors.contract_value}
              />
              <Information label="Currency" value={string(displayedValues.currency) || string(context?.prefill.currency) || "—"} error={errors.currency} />
            </>
          ) : (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-semibold text-slate-500">Commercial Scope</dt>
              <dd className="mt-1 text-sm font-medium text-slate-700">
                Non-Financial Agreement &bull; Governed by confidentiality obligations
              </dd>
            </div>
          )}

          <Information label="Department" value={record.department || workflow?.department || "Production - NSGAI"} />
          <Information label="Company" value={record.company || "Netlink"} />
          <Information label="Requester" value={record.requester || (workflow && "requester" in workflow ? (workflow as Record<string, unknown>).requester : "") || "—"} />
        </dl>

        {/* Awarded Item Rows & Commercial Breakdown (Shown for Supply / Procurement Contract) */}
        {typeConfig.showAwardedItems && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Awarded Item Rows &amp; Commercial Breakdown
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {awardedItems.length} {awardedItems.length === 1 ? "Item" : "Items"}
                </span>
              </div>
              {sqQuery.isLoading && (
                <span className="text-xs text-slate-500 animate-pulse">Loading awarded lines…</span>
              )}
            </div>

            {awardedItems.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700" aria-label="Awarded Item Rows">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th scope="col" className="px-3.5 py-2.5">Item Code</th>
                      <th scope="col" className="px-3.5 py-2.5">Item Name / Description</th>
                      <th scope="col" className="px-3.5 py-2.5 text-right">Quantity</th>
                      <th scope="col" className="px-3.5 py-2.5 text-center">UOM</th>
                      <th scope="col" className="px-3.5 py-2.5 text-right">Unit Rate</th>
                      <th scope="col" className="px-3.5 py-2.5 text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {awardedItems.map((item, index) => {
                      const itemRate = Number(item.rate || 0);
                      const itemQty = Number(item.qty || 0);
                      const itemAmount = item.amount != null ? Number(item.amount) : itemQty * itemRate;
                      const currencyStr = string(displayedValues.currency) || string(context?.prefill.currency) || "USD";
                      return (
                        <tr key={item.item_code || item.name || index} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-3.5 py-2 font-mono font-medium text-slate-900">{item.item_code}</td>
                          <td className="px-3.5 py-2">
                            <p className="font-medium text-slate-800">{item.item_name || item.item_code}</p>
                            {item.description && item.description !== item.item_name && (
                              <p className="text-[11px] text-slate-500 truncate max-w-xs">{item.description}</p>
                            )}
                          </td>
                          <td className="px-3.5 py-2 text-right font-medium text-slate-900">{itemQty.toLocaleString()}</td>
                          <td className="px-3.5 py-2 text-center text-slate-500">{item.uom || "Unit"}</td>
                          <td className="px-3.5 py-2 text-right font-mono text-slate-700">
                            {currencyStr} {itemRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono font-semibold text-slate-900">
                            {currencyStr} {itemAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50/80 border-t border-slate-200 font-semibold text-slate-900">
                    <tr>
                      <td colSpan={4} className="px-3.5 py-2.5 text-right text-xs">Total Award Value:</td>
                      <td colSpan={2} className="px-3.5 py-2.5 text-right font-mono text-sm text-blue-900">
                        {hasValue(displayedValues.contract_value)
                          ? `${string(displayedValues.currency)} ${Number(displayedValues.contract_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                <p>
                  {sqQuery.isLoading
                    ? "Retrieving line-item breakdown for the winning quotation…"
                    : "Itemized breakdown captured from quotation / award total."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Service / Non-Goods summary card when not showing goods table */}
        {!typeConfig.showAwardedItems && (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600 flex items-center justify-between gap-3">
            <p>
              {currentContractType === "NDA"
                ? "Confidentiality agreement protecting proprietary specifications and data disclosed under this RFQ."
                : `Service and performance agreement linked to RFQ ${rfq || "award"}. Goods item lines omitted.`}
            </p>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold border ${typeConfig.badgeColor}`}>
              {typeConfig.badge}
            </span>
          </div>
        )}

        {query.isLoading && (
          <p role="status" className="mt-2 text-xs text-slate-500">
            Loading saved award information…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="mt-2 text-xs text-rose-700 flex items-center gap-2">
            <span>{clmError(query.error)}</span>
            <button type="button" className={`${CLM_BUTTON} py-0.5 px-2 text-xs`} onClick={() => void query.refetch()}>
              Retry award
            </button>
          </div>
        )}
        {context && !matches && (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            The RFQ does not reference this Contract Request. Refresh before continuing.
          </p>
        )}
        {matches && context?.reason && <p className="mt-2 text-xs text-slate-600">{context.reason}</p>}
      </section>

      {/* 5. DYNAMIC CONTRACT DETAILS FORM */}
      <section
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-5"
        aria-label="Contract Details Form"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Contract Terms &amp; Classification</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Select contract classification to dynamically tailor terms, commercial clauses, and legal requirements.
            </p>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold border ${typeConfig.badgeColor}`}>
            {typeConfig.badge}
          </span>
        </div>

        {/* Dynamic Contract Type Selector Card */}
        <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/60 via-slate-50 to-indigo-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="select-contract-type" className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                Selected Contract Type <span className="text-rose-600">*</span>
              </label>
              <select
                id="select-contract-type"
                disabled={!!busy || !editable}
                value={string(values.contract_type)}
                onChange={e => handleContractTypeChange(e.target.value)}
                className="w-full sm:max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-2xs focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              >
                <option value="">Select Contract Type…</option>
                {RFQ_CONTRACT_TYPES.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.contract_type && (
                <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">
                  {errors.contract_type}
                </p>
              )}
            </div>
            <div className="max-w-xs text-xs text-slate-600 bg-white/80 rounded-lg p-2.5 border border-slate-200 shadow-2xs">
              <p className="font-semibold text-slate-800">{typeConfig.title}</p>
              <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">{typeConfig.description}</p>
            </div>
          </div>
        </div>

        {/* Core Terms: Handled via ClmFields for complete schema synchronization */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Core Contract Specifications &amp; Schedule
            </h3>
            <span className="text-[11px] text-slate-500">Fields adapt to {typeConfig.title}</span>
          </div>

          <fieldset disabled={!!busy || !editable} className="min-w-0">
            <ClmFields
              fields={dynamicTermFields}
              doctype="Contract Request"
              values={displayedValues}
              onChange={next => {
                dirty.current = true;
                setValues(withAwardValues(next, matches ? context : undefined));
              }}
              editableFields={dynamicTermNames}
              readOnlyFields={readOnlyTerms}
              errors={errors}
            />
          </fieldset>
        </div>

        {/* TYPE-SPECIFIC CONDITIONAL SECTIONS */}

        {/* A. SUPPLY / PROCUREMENT CONTRACT TERMS */}
        {currentContractType === "Supply / Procurement Contract" && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Procurement Commercial &amp; Operational Terms
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Negotiated payment terms, logistics incoterms, quality inspection, and warranty terms.
                </p>
              </div>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200">
                Supply Specifics
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Payment Terms */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-payment-terms" className="text-xs font-bold text-slate-700">
                    Payment Terms <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">e.g. Net 30, Net 60</span>
                </div>
                <input
                  id="input-payment-terms"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.payment_terms}
                  onChange={e => updateExtraTerm("payment_terms", e.target.value)}
                  placeholder="e.g. Net 30"
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.payment_terms ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100 disabled:text-slate-500`}
                />
                {editable && !busy && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    {["Net 30", "Net 45", "Net 60", "Net 90", "Due Upon Receipt"].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateExtraTerm("payment_terms", t)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${extraTerms.payment_terms === t
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {errors.payment_terms && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.payment_terms}</p>
                )}
              </div>

              {/* Delivery Terms / Incoterms */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-delivery-terms" className="text-xs font-bold text-slate-700">
                    Delivery Terms / Incoterms <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">e.g. Incoterms</span>
                </div>
                <input
                  id="input-delivery-terms"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.delivery_terms}
                  onChange={e => updateExtraTerm("delivery_terms", e.target.value)}
                  placeholder="e.g. DAP - Delivered at Place"
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.delivery_terms ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100 disabled:text-slate-500`}
                />
                {editable && !busy && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    {["DAP - Delivered at Place", "FOB - Free on Board", "EXW - Ex Works", "CIF - Cost & Freight"].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateExtraTerm("delivery_terms", t)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${extraTerms.delivery_terms === t
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {errors.delivery_terms && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.delivery_terms}</p>
                )}
              </div>

              {/* Inspection and Acceptance Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-inspection-terms" className="text-xs font-bold text-slate-700">
                  Inspection &amp; Acceptance Terms
                </label>
                <input
                  id="input-inspection-terms"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.inspection_terms}
                  onChange={e => updateExtraTerm("inspection_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Warranty Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-warranty-terms" className="text-xs font-bold text-slate-700">
                  Warranty Terms
                </label>
                <input
                  id="input-warranty-terms"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.warranty_terms}
                  onChange={e => updateExtraTerm("warranty_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Penalties / Liquidated Damages */}
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="input-penalties" className="text-xs font-bold text-slate-700">
                  Penalties / Liquidated Damages
                </label>
                <input
                  id="input-penalties"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.penalties}
                  onChange={e => updateExtraTerm("penalties", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>
        )}

        {/* B. SERVICE AGREEMENT TERMS */}
        {currentContractType === "Service Agreement" && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Service Level Agreement (SLA) &amp; Governance Terms
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Payment milestones, SLA response targets, performance KPIs, and renewal/termination conditions.
                </p>
              </div>
              <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800 border border-purple-200">
                Service Governance
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Payment Schedule / Payment Terms */}
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-service-payment" className="text-xs font-bold text-slate-700">
                    Payment Schedule / Payment Terms <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">e.g. Milestone-based, Monthly</span>
                </div>
                <input
                  id="input-service-payment"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.payment_terms}
                  onChange={e => updateExtraTerm("payment_terms", e.target.value)}
                  placeholder="e.g. Monthly milestone invoicing in arrears; Net 30 days"
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.payment_terms ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100 disabled:text-slate-500`}
                />
                {editable && !busy && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    {["Net 30", "Net 45", "Monthly In Arrears", "Milestone Billing", "Progress Invoicing"].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateExtraTerm("payment_terms", t)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${extraTerms.payment_terms === t ? "bg-purple-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {errors.payment_terms && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.payment_terms}</p>
                )}
              </div>

              {/* Service Level Agreement (SLA) */}
              <div className="space-y-1.5">
                <label htmlFor="input-sla-terms" className="text-xs font-bold text-slate-700">
                  Service Level Agreement (SLA)
                </label>
                <input
                  id="input-sla-terms"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.sla_terms}
                  onChange={e => updateExtraTerm("sla_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Performance KPIs */}
              <div className="space-y-1.5">
                <label htmlFor="input-kpis" className="text-xs font-bold text-slate-700">
                  Performance KPIs
                </label>
                <input
                  id="input-kpis"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.performance_kpis}
                  onChange={e => updateExtraTerm("performance_kpis", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Renewal Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-renewal" className="text-xs font-bold text-slate-700">
                  Renewal Terms
                </label>
                <input
                  id="input-renewal"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.renewal_terms}
                  onChange={e => updateExtraTerm("renewal_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Termination Conditions */}
              <div className="space-y-1.5">
                <label htmlFor="input-termination" className="text-xs font-bold text-slate-700">
                  Termination Conditions
                </label>
                <input
                  id="input-termination"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.termination_terms}
                  onChange={e => updateExtraTerm("termination_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>
        )}

        {/* C. NON-DISCLOSURE AGREEMENT (NDA) TERMS */}
        {currentContractType === "NDA" && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Non-Disclosure Parties &amp; Confidentiality Covenants
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Protected technical disclosures, proprietary scope, confidentiality obligations, and governing law.
                </p>
              </div>
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 border border-indigo-200">
                Confidentiality Covenants
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Disclosing Party */}
              <div className="space-y-1.5">
                <label htmlFor="input-disclosing-party" className="text-xs font-bold text-slate-700">
                  Disclosing Party <span className="text-rose-600">*</span>
                </label>
                <input
                  id="input-disclosing-party"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.disclosing_party}
                  onChange={e => updateExtraTerm("disclosing_party", e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.disclosing_party ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100`}
                />
                {errors.disclosing_party && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.disclosing_party}</p>
                )}
              </div>

              {/* Receiving Party */}
              <div className="space-y-1.5">
                <label htmlFor="input-receiving-party" className="text-xs font-bold text-slate-700">
                  Receiving Party <span className="text-rose-600">*</span>
                </label>
                <input
                  id="input-receiving-party"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.receiving_party}
                  onChange={e => updateExtraTerm("receiving_party", e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.receiving_party ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100`}
                />
                {errors.receiving_party && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.receiving_party}</p>
                )}
              </div>

              {/* Confidential Information Scope */}
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="input-confidential-scope" className="text-xs font-bold text-slate-700">
                  Confidential Information Scope <span className="text-rose-600">*</span>
                </label>
                <textarea
                  id="input-confidential-scope"
                  rows={2}
                  disabled={!!busy || !editable}
                  value={extraTerms.confidential_scope}
                  onChange={e => updateExtraTerm("confidential_scope", e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.confidential_scope ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100`}
                />
                {errors.confidential_scope && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.confidential_scope}</p>
                )}
              </div>

              {/* Confidentiality Obligations */}
              <div className="space-y-1.5">
                <label htmlFor="input-obligations" className="text-xs font-bold text-slate-700">
                  Confidentiality Obligations &amp; Duration
                </label>
                <textarea
                  id="input-obligations"
                  rows={2}
                  disabled={!!busy || !editable}
                  value={extraTerms.confidentiality_obligations}
                  onChange={e => updateExtraTerm("confidentiality_obligations", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Permitted Disclosures */}
              <div className="space-y-1.5">
                <label htmlFor="input-disclosures" className="text-xs font-bold text-slate-700">
                  Permitted Disclosures
                </label>
                <textarea
                  id="input-disclosures"
                  rows={2}
                  disabled={!!busy || !editable}
                  value={extraTerms.permitted_disclosures}
                  onChange={e => updateExtraTerm("permitted_disclosures", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Governing Law */}
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="input-governing-law" className="text-xs font-bold text-slate-700">
                  Governing Law &amp; Jurisdiction
                </label>
                <input
                  id="input-governing-law"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.governing_law}
                  onChange={e => updateExtraTerm("governing_law", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
                {editable && !busy && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    {["State of Delaware, United States", "State of Michigan, United States", "State of New York, United States", "English Law & Jurisdiction"].map(law => (
                      <button
                        key={law}
                        type="button"
                        onClick={() => updateExtraTerm("governing_law", law)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${extraTerms.governing_law === law ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                      >
                        {law}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* D. MASTER SERVICE AGREEMENT (MSA) TERMS */}
        {currentContractType === "Master Service Agreement" && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Master Service Agreement (MSA) Operational Framework
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Overarching payment framework, cross-SOW performance governance, and multi-year legal provisions.
                </p>
              </div>
              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 border border-teal-200">
                Master Framework
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Payment Framework */}
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="input-msa-payment" className="text-xs font-bold text-slate-700">
                    Payment Framework <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">Master Terms</span>
                </div>
                <input
                  id="input-msa-payment"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.payment_terms}
                  onChange={e => updateExtraTerm("payment_terms", e.target.value)}
                  placeholder="e.g. Standard Net 45 upon invoice approval per issued Statement of Work (SOW)"
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.payment_terms ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100 disabled:text-slate-500`}
                />
                {editable && !busy && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    {["Net 30", "Net 45", "Net 60", "Per SOW Terms"].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateExtraTerm("payment_terms", t)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${extraTerms.payment_terms === t ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {errors.payment_terms && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.payment_terms}</p>
                )}
              </div>

              {/* Service Levels & Performance Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-msa-sla" className="text-xs font-bold text-slate-700">
                  Service Levels &amp; Performance Terms
                </label>
                <input
                  id="input-msa-sla"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.sla_terms}
                  onChange={e => updateExtraTerm("sla_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Governing Law */}
              <div className="space-y-1.5">
                <label htmlFor="input-msa-law" className="text-xs font-bold text-slate-700">
                  Governing Law
                </label>
                <input
                  id="input-msa-law"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.governing_law}
                  onChange={e => updateExtraTerm("governing_law", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Renewal Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-msa-renewal" className="text-xs font-bold text-slate-700">
                  Renewal Terms
                </label>
                <input
                  id="input-msa-renewal"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.renewal_terms}
                  onChange={e => updateExtraTerm("renewal_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Termination Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-msa-term" className="text-xs font-bold text-slate-700">
                  Termination Terms
                </label>
                <input
                  id="input-msa-term"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.termination_terms}
                  onChange={e => updateExtraTerm("termination_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>
        )}

        {/* E. OTHER / CUSTOM CONTRACT TERMS */}
        {currentContractType === "Other" && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Bespoke Agreement Details &amp; Commercial Terms
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Custom contract title, counterparty designation, and general commercial conditions.
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 border border-slate-200">
                Custom Terms
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Contract Title / Type Description */}
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="input-custom-title" className="text-xs font-bold text-slate-700">
                  Contract Title / Type Description <span className="text-rose-600">*</span>
                </label>
                <input
                  id="input-custom-title"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.custom_title}
                  onChange={e => updateExtraTerm("custom_title", e.target.value)}
                  placeholder="e.g. Intellectual Property License Agreement"
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${errors.custom_title ? "border-rose-400 bg-rose-50/30" : "border-slate-300 bg-white"
                    } disabled:bg-slate-100`}
                />
                {errors.custom_title && (
                  <p role="alert" className="text-xs font-semibold text-rose-700">{errors.custom_title}</p>
                )}
              </div>

              {/* Payment Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-other-payment" className="text-xs font-bold text-slate-700">
                  Payment Terms
                </label>
                <input
                  id="input-other-payment"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.payment_terms}
                  onChange={e => updateExtraTerm("payment_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {/* Delivery / Operational Terms */}
              <div className="space-y-1.5">
                <label htmlFor="input-other-delivery" className="text-xs font-bold text-slate-700">
                  Delivery / Operational Terms
                </label>
                <input
                  id="input-other-delivery"
                  type="text"
                  disabled={!!busy || !editable}
                  value={extraTerms.delivery_terms}
                  onChange={e => updateExtraTerm("delivery_terms", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>
        )}

        {/* Required Legal Review setup fields */}
        {canCreate && reviewFields.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
              Legal Review Handoff Attributes
            </h3>
            <fieldset disabled={!!busy} className="min-w-0 space-y-4">
              {reviewFields.filter(f => f.fieldname !== "custom_inteva_signatory").length > 0 && (
                <ClmFields
                  fields={reviewFields.filter(f => f.fieldname !== "custom_inteva_signatory")}
                  doctype="Contract"
                  values={reviews}
                  onChange={setReviews}
                  editableFields={Object.keys(reviewLabels)}
                  errors={errors}
                />
              )}

              {/* Automatic Legal Manager Signatory Assignment Summary */}
              {assignedSignatory ? (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-2xs"
                  data-contract-field="custom_inteva_signatory"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs font-bold uppercase tracking-wider text-slate-600">
                        Legal Manager Signatory
                      </dt>
                      <dd className="text-sm font-semibold text-slate-900">
                        {assignedName}
                      </dd>
                      <dd className="text-xs text-slate-600 font-mono">
                        {assignedEmail}
                      </dd>
                      <dd className="pt-1">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
                          Assigned automatically from existing workflow configuration
                        </span>
                      </dd>
                    </div>
                    {canReassign && (
                      <button
                        type="button"
                        onClick={() => setAdminEditingAssignee(prev => !prev)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
                      >
                        {adminEditingAssignee ? "Cancel" : "Change Assignee"}
                      </button>
                    )}
                  </div>

                  {canReassign && adminEditingAssignee && (
                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                      <label htmlFor="select-admin-signatory" className="block text-xs font-semibold text-slate-700">
                        Reassign Legal Manager Signatory
                      </label>
                      <select
                        id="select-admin-signatory"
                        value={assignedSignatory}
                        onChange={e => {
                          setReviews(prev => ({ ...prev, custom_inteva_signatory: e.target.value }));
                          setAdminEditingAssignee(false);
                          setErrors(prev => {
                            const copy = { ...prev };
                            delete copy.custom_inteva_signatory;
                            return copy;
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Select Legal Manager --</option>
                        {(legalResolution?.eligible_signatories || []).map(u => (
                          <option key={u.name} value={u.name}>
                            {u.full_name} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {errors.custom_inteva_signatory && (
                    <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                      {errors.custom_inteva_signatory}
                    </p>
                  )}
                </div>
              ) : (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs"
                  data-contract-field="custom_inteva_signatory"
                >
                  <div className="space-y-3">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs font-bold uppercase tracking-wider text-amber-800">
                        Legal Manager Signatory
                      </dt>
                      <p role="alert" className="text-xs font-medium text-amber-900">
                        {legalResolution?.error || "Designate an eligible Legal Manager as the company signatory before creating the Contract."}
                      </p>
                    </div>

                    {(canCreate || canReassign) && (
                      <div className="pt-2 border-t border-amber-200/60 space-y-2">
                        <label htmlFor="select-admin-signatory" className="block text-xs font-semibold text-slate-700">
                          Designate Legal Manager Signatory <span className="text-rose-600">*</span>
                        </label>
                        <select
                          id="select-admin-signatory"
                          value={assignedSignatory}
                          onChange={e => {
                            setReviews(prev => ({ ...prev, custom_inteva_signatory: e.target.value }));
                            setErrors(prev => {
                              const copy = { ...prev };
                              delete copy.custom_inteva_signatory;
                              return copy;
                            });
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Select Legal Manager --</option>
                          {(legalResolution?.eligible_signatories || []).map(u => (
                            <option key={u.name} value={u.name}>
                              {u.full_name} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {errors.custom_inteva_signatory && (
                    <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                      {errors.custom_inteva_signatory}
                    </p>
                  )}
                </div>
              )}
            </fieldset>
            {errors.review && (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                {errors.review}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 6. CONTRACT DOCUMENT SECTION */}
      <section
        className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs"
        aria-label="Contract Document and Attachments"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{typeConfig.documentTitle}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{typeConfig.documentHelp}</p>
          </div>
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
            {typeConfig.documentBadge}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {attachedFile ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs shadow-2xs">
                  PDF
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900" title={attachedFile.name}>
                    {attachedFile.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(attachedFile.size / 1024).toFixed(1)} KB &bull; {busy === "upload" ? "Uploading to ERPNext…" : "Attached for Legal Review"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {attachedFile.url && (
                  <button
                    type="button"
                    className={CLM_BUTTON}
                    onClick={() =>
                      setPreviewDoc({
                        url: attachedFile.url!,
                        type: "application/pdf",
                        name: attachedFile.name,
                        bytes: attachedFile.bytes,
                      })
                    }
                  >
                    Preview PDF
                  </button>
                )}
                <button
                  type="button"
                  className={CLM_BUTTON}
                  disabled={!editable}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
                  disabled={!editable}
                  onClick={() => setAttachedFile(null)}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50/50" : "border-slate-200 hover:border-slate-300 bg-slate-50/50"
                }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 mb-2">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="text-xs sm:text-sm font-semibold text-slate-800">
                Drag and drop your contract PDF here, or{" "}
                <button
                  type="button"
                  className="text-blue-700 hover:underline font-bold"
                  disabled={!editable}
                  onClick={() => fileInputRef.current?.click()}
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-xs text-slate-500">Supports PDF, DOCX up to 10 MB. Sent to Legal upon contract creation.</p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf"
            className="hidden"
            onChange={onFileInputChange}
          />

          {/* Source Supporting Documents from RFQ */}
          <div className="pt-3 border-t border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Supporting Documents from RFQ</h3>
            {documents.length ? (
              <RfqSourceDocuments
                rfq={rfq}
                recordName={record.name}
                doctype="Contract Request"
                documents={documents}
                canOpenSource={canAccessPath(role || "", `/sourcing/rfq/${encodeURIComponent(rfq)}`)}
              />
            ) : (
              <p className="text-xs text-slate-500">No supporting documents available for this contract request.</p>
            )}
          </div>
        </div>
      </section>

      {/* Confirmation Summary Banner (Prior to creation) */}
      {!handedOff && canCreate && (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-slate-50 p-4 text-xs shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold">
                i
              </span>
              <h3 className="font-bold text-blue-950">Contract Handoff Confirmation Summary</h3>
            </div>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border ${typeConfig.badgeColor}`}>
              {typeConfig.badge}
            </span>
          </div>
          <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-slate-500 font-medium">Contracting Parties</dt>
              <dd className="font-semibold text-slate-900 truncate">
                {string(record.company || "Netlink")} &bull; {supplier || "Pending"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 font-medium">Validity Term</dt>
              <dd className="font-semibold text-slate-900">
                {string(displayedValues.contract_start_date) || "—"} to {string(displayedValues.contract_end_date) || "Open"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 font-medium">Commercial Commitment</dt>
              <dd className="font-semibold text-slate-900">
                {!typeConfig.showCommercialAmounts
                  ? "Non-Financial Agreement"
                  : hasValue(displayedValues.contract_value)
                    ? `${string(displayedValues.currency)} ${Number(displayedValues.contract_value).toLocaleString()}`
                    : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 font-medium">Contract Document</dt>
              <dd className="font-semibold text-slate-900 truncate">
                {attachedFile ? attachedFile.name : "None attached (Optional)"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Status / Error notices */}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm font-semibold text-rose-800 shadow-2xs">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="break-words rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs sm:text-sm font-semibold text-blue-900 shadow-2xs">
          {notice}
        </p>
      )}

      {/* 7. SINGLE FOOTER ACTION BAR */}
      <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md p-4 shadow-lg">
        <div className="min-w-0 text-xs font-medium text-slate-600">
          Contract Request: <strong className="font-mono text-slate-900">{record.name}</strong>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/contract-requests"
            className={CLM_BUTTON}
          >
            Cancel
          </Link>

          {editable && !handedOff && (
            <button
              type="button"
              className={CLM_BUTTON}
              disabled={!!busy}
              onClick={() => void saveDraft()}
            >
              {busy === "save" ? "Saving…" : "Save Draft"}
            </button>
          )}

          {canCreate && !handedOff && (
            <button
              type="button"
              className={`${CLM_PRIMARY} shadow-xs`}
              disabled={!!busy || query.isLoading || !matches}
              onClick={() => void createContract()}
            >
              {busy === "create" ? "Creating…" : resuming ? "Resume Contract creation" : "Create Contract"}
            </button>
          )}

          {handedOff && existingContract && (
            <Link className={CLM_PRIMARY} to={clmRecordRoute("Contract", existingContract)}>
              View Contract
            </Link>
          )}
        </div>
      </footer>

      {/* Modal for PDF Preview */}
      {previewDoc && (
        <ContractPdfPreviewModal
          contractId={record.name}
          preview={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}
