import { useState, useMemo, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Paperclip,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  Lock,
  AlertTriangle,
  Building2,
  Download,
  Edit3,
  Save,
  ChevronDown,
  Check,
  PenLine,
  Scale,
  Eye,
  FileCheck,
  FileText,
  CheckSquare,
  MessageSquare,
  Briefcase,
  Wrench,
  ListChecks,
  Layers,
} from "lucide-react";

import {
  fetchBusinessCaseById,
  fetchBusinessNeedById,
  saveBusinessCaseFinancials,
  completeEngineerTechnicalReview,
  approveEngineeringStage,
  approveFinanceStage,
  approveProcurementStage,
  approveLegalStage,
  sendBackBusinessCase,
  rejectBusinessCase,
  linkRfqToBusinessCase,
  updateBusinessCaseSection,
  isFinanceManagerRole,
  isEngineerRole,
  isEngineeringManagerRole,
  isLegalManagerRole,
  isProcurementManagerRole,
  isDepartmentUserRole,
} from "../../api/businessIntake";
import { getFullFileUrl, resolveAttachmentUrl, isImageAttachment, openErpFileInBrowser } from "../../api/legalDocsStorage";
import { calculateBusinessCaseFinancials } from "../../utils/financialCalculations";
import type { FinanceChecklistState, TechnicalRequirementItem } from "../../types/businessIntake";
import { IntakeWorkflowTimeline } from "../../components/intake/IntakeWorkflowTimeline";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import { CreateRFQFromBusinessCaseModal } from "../../components/intake/CreateRFQFromBusinessCaseModal";
import { BusinessCasePdfPreviewModal } from "../../components/intake/BusinessCasePdfPreviewModal";
import LegalESignModal from "../../components/legal/LegalESignModal";
import { TechnicalRequirementsEditor } from "../../components/intake/TechnicalRequirementsEditor";
import { formatCurrency, formatDate } from "../../utils/format";
import { useAuthStore } from "../../store/authStore";
import { useLayout } from "../../contexts/LayoutContext";
import type { LegalSignatureFontId } from "../../types/legalSignatureFonts";

export interface LegalReviewDocItem {
  id?: string;
  name: string;
  document_type: string;
  uploaded_by: string;
  uploaded_date: string;
  version: string;
  status: "Available" | "Pending Review" | "Reviewed" | "Requires Clarification" | "Rejected";
  file_url?: string;
  file_id?: string;
  size?: string;
  clarification_comment?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export const LEGAL_CHECKLIST_ITEMS = [
  {
    key: "businessRequirements",
    label: "Business Case legal requirements reviewed",
    desc: "Procurement alignment with operational scope, intended deliverables, and organizational objectives.",
  },
  {
    key: "supplierDocReviewed",
    label: "Supplier documentation reviewed",
    desc: "Supplier specifications, technical data sheets, and company credentials thoroughly evaluated.",
  },
  {
    key: "complianceCertificates",
    label: "Compliance certificates reviewed",
    desc: "All required ISO, industry certifications, quality standards, and safety compliances are active.",
  },
  {
    key: "regulatoryRequirements",
    label: "Regulatory requirements reviewed",
    desc: "Statutory laws, regional manufacturing regulations, and import/export compliances are fully satisfied.",
  },
  {
    key: "contractualRequirements",
    label: "Contractual requirements reviewed",
    desc: "Payment terms, governing law, delivery obligations, IP protections, and SLAs adhere to company standards.",
  },
  {
    key: "warrantyLiabilityTerms",
    label: "Warranty / liability terms reviewed",
    desc: "Indemnity thresholds, warranty coverage, liability caps, and dispute resolution mechanisms approved.",
  },
  {
    key: "requiredLegalDocsAvailable",
    label: "Required legal documents available",
    desc: "All mandatory legal exhibits, NDAs, licenses, and terms sheets are uploaded and attached.",
  },
  {
    key: "noUnresolvedExceptions",
    label: "No unresolved legal exceptions",
    desc: "All document clarifications and exceptions have been resolved with zero blocking caveats.",
  },
  {
    key: "finalReviewCompleted",
    label: "Final legal review completed",
    desc: "Comprehensive review completed and confirmed ready for electronic signature and procurement execution.",
  },
] as const;

export const ENGINEER_CHECKLIST_ITEMS = [
  {
    key: "technicalRequirementReviewed",
    label: "Technical requirement reviewed",
    desc: "All item descriptions, technical scopes, and functional parameters have been verified.",
  },
  {
    key: "quantityUomVerified",
    label: "Quantity and UOM verified",
    desc: "Bill of materials quantities, units of measure, and expected scale validated.",
  },
  {
    key: "technicalSpecVerified",
    label: "Technical specification verified",
    desc: "Datasheets, tolerances, and engineering specifications conform to facility standards.",
  },
  {
    key: "performanceReqsVerified",
    label: "Performance requirements verified",
    desc: "Speed, capacity, throughput, MTBF, availability, and operating duty cycle confirmed.",
  },
  {
    key: "qualityReqsVerified",
    label: "Quality requirements verified",
    desc: "Quality inspection protocols, ISO / IATF standards, and test procedures verified.",
  },
  {
    key: "deliveryReqsVerified",
    label: "Delivery requirements verified",
    desc: "Delivery schedule, packaging, transport constraints, and installation timelines verified.",
  },
  {
    key: "integrationReqsVerified",
    label: "Integration requirements verified",
    desc: "Interfacing with existing plant machinery, controls (PLC/SCADA), power, and IT verified.",
  },
  {
    key: "safetyReqsVerified",
    label: "Safety requirements verified",
    desc: "OSHA, CE/UL machinery safety, interlocking, emergency stops, and hazard mitigations confirmed.",
  },
  {
    key: "supportingDocsReviewed",
    label: "Supporting technical documents reviewed",
    desc: "Vendor drawings, schematics, engineering calculations, and user manuals reviewed.",
  },
] as const;

type TabId =
  | "engineering_approval"
  | "technical_review"
  | "overview"
  | "legal_review"
  | "business_info"
  | "justification"
  | "alternatives"
  | "financials"
  | "technical"
  | "strategy"
  | "review_gates"
  | "risk"
  | "compliance"
  | "documents"
  | "history"
  | "rfq";

export default function BusinessCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { sidebarOffset, sidebarMode } = useLayout();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [commentText, setCommentText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [sendBackReason, setSendBackReason] = useState("");
  const [actionModal, setActionModal] = useState<"none" | "approve" | "reject" | "send_back">("none");
  const [isRfqModalOpen, setIsRfqModalOpen] = useState(false);
  const [isLegalEsignModalOpen, setIsLegalEsignModalOpen] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isMoreTabsOpen, setIsMoreTabsOpen] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Dedicated Document Preview Modal state
  const [pdfPreviewModal, setPdfPreviewModal] = useState<{
    isOpen: boolean;
    fileName: string;
    documentType: string;
    directUrl?: string;
    file?: any;
  }>({
    isOpen: false,
    fileName: "",
    documentType: "General Supporting Document",
  });

  const handleOpenPdfPreview = (fileName: string, documentType?: string, directUrl?: string, file?: any) => {
    setPdfPreviewModal({
      isOpen: true,
      fileName,
      documentType: documentType || "General Supporting Document",
      directUrl: directUrl || (file ? resolveAttachmentUrl(file) : undefined),
      file,
    });
  };

  // Document clarification & preview modals
  const [clarificationModalDoc, setClarificationModalDoc] = useState<LegalReviewDocItem | null>(null);
  const [clarificationComment, setClarificationComment] = useState("");
  const [previewDoc, setPreviewDoc] = useState<LegalReviewDocItem | null>(null);

  // Legal Review Checklist State (9 Mandatory Items)
  const [legalChecklist, setLegalChecklist] = useState<Record<string, boolean>>({
    businessRequirements: false,
    supplierDocReviewed: false,
    complianceCertificates: false,
    regulatoryRequirements: false,
    contractualRequirements: false,
    warrantyLiabilityTerms: false,
    requiredLegalDocsAvailable: false,
    noUnresolvedExceptions: false,
    finalReviewCompleted: false,
  });

  // Engineer Review Checklist State (9 Mandatory Items)
  const [engineerChecklist, setEngineerChecklist] = useState<Record<string, boolean>>({
    technicalRequirementReviewed: false,
    quantityUomVerified: false,
    technicalSpecVerified: false,
    performanceReqsVerified: false,
    qualityReqsVerified: false,
    deliveryReqsVerified: false,
    integrationReqsVerified: false,
    safetyReqsVerified: false,
    supportingDocsReviewed: false,
  });

  const isEngineerChecklistComplete = useMemo(() => {
    return ENGINEER_CHECKLIST_ITEMS.every((item) => Boolean(engineerChecklist[item.key]));
  }, [engineerChecklist]);

  const engineerChecklistProgress = useMemo(() => {
    const completed = ENGINEER_CHECKLIST_ITEMS.filter((item) => engineerChecklist[item.key]).length;
    return Math.round((completed / ENGINEER_CHECKLIST_ITEMS.length) * 100);
  }, [engineerChecklist]);

  // Collapsible sections state for Business Case Reference Information
  const [openRefSections, setOpenRefSections] = useState<Record<string, boolean>>({
    businessInfo: false,
    justification: false,
    alternatives: false,
    financials: false,
    strategy: false,
    risk: false,
    documents: false,
    auditTrail: false,
  });

  const toggleRefSection = (key: string) => {
    setOpenRefSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllRefSections = (open: boolean) => {
    setOpenRefSections({
      businessInfo: open,
      justification: open,
      alternatives: open,
      financials: open,
      strategy: open,
      risk: open,
      documents: open,
      auditTrail: open,
    });
  };

  // Per-document review state overrides
  const [docReviewStatuses, setDocReviewStatuses] = useState<
    Record<string, { status: "Pending Review" | "Reviewed" | "Requires Clarification" | "Rejected"; comment?: string }>
  >({});

  // Financial form state
  const [finCapex, setFinCapex] = useState<number | "">("");
  const [finOpex, setFinOpex] = useState<number | "">("");
  const [finSavings, setFinSavings] = useState<number | "">("");
  const [finRevenue, setFinRevenue] = useState<number | "">("");
  const [finCostAvoid, setFinCostAvoid] = useState<number | "">("");
  const [finDuration, setFinDuration] = useState<number | "">("");
  const [finDiscountRate, setFinDiscountRate] = useState<number | "">("");
  const [finSuccessMsg, setFinSuccessMsg] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");

  // Section-specific inline edits
  const [inlineSection, setInlineSection] = useState<string | null>(null);
  const [strategyProcType, setStrategyProcType] = useState("");
  const [strategySourcing, setStrategySourcing] = useState("");
  const [strategyNotes, setStrategyNotes] = useState("");
  const [complianceNotes, setComplianceNotes] = useState("");

  // Finance Gate Checklist State
  const financeChecklist: FinanceChecklistState = useMemo(
    () => ({
      budgetVerified: true,
      capexOpexVerified: true,
      financialAssumptionsReviewed: true,
      requiredDocumentsReviewed: true,
      requiredSignaturesVerified: true,
      businessJustificationReviewed: true,
      financialFeasibilityConfirmed: true,
    }),
    [],
  );

  const { data: businessCase, isLoading } = useQuery({
    queryKey: ["business-case", id],
    queryFn: () => fetchBusinessCaseById(id || ""),
    enabled: Boolean(id),
  });

  const { data: need } = useQuery({
    queryKey: ["business-need", businessCase?.business_need_id],
    queryFn: () => fetchBusinessNeedById(businessCase?.business_need_id || ""),
    enabled: Boolean(businessCase?.business_need_id),
  });

  const displayBudget = useMemo(() => {
    if (businessCase?.budget && businessCase.budget > 0) return businessCase.budget;
    if (need?.estimated_budget && need.estimated_budget > 0) return need.estimated_budget;
    return 0;
  }, [businessCase?.budget, need?.estimated_budget]);

  const displayCurrency = businessCase?.currency || need?.currency || "USD";

  useEffect(() => {
    if (businessCase) {
      setFinCapex(businessCase.capex > 0 ? businessCase.capex : displayBudget > 0 ? displayBudget : "");
      setFinOpex(businessCase.opex ?? 0);
      setFinSavings(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0);
      setFinRevenue(businessCase.revenue_increase ?? 0);
      setFinCostAvoid(businessCase.cost_avoidance ?? 0);
      setFinDuration(businessCase.project_duration ?? 5);
      setFinDiscountRate(businessCase.discount_rate ?? 10);
      setStrategyProcType(businessCase.procurement_type || "Direct");
      setStrategySourcing(businessCase.procurement_strategy || "Competitive RFQ");
      setStrategyNotes(businessCase.procurement_justification || "");
      setComplianceNotes(businessCase.compliance_notes || "");

      const rawRole = user?.role || "";
      const emailLower = user?.email?.toLowerCase() || "";
      const isEngMgr = isEngineeringManagerRole(rawRole) || emailLower.includes("engineeringmanager") || emailLower.includes("engmgr");
      const isEngineer = !isEngMgr && (isEngineerRole(rawRole) || (emailLower.includes("engineer") && !emailLower.includes("manager")));
      const isPendingEngineering =
        businessCase.workflow_status === "Pending Engineering" ||
        businessCase.workflow_status === "Pending Technical Review" ||
        businessCase.workflow_status === "Submitted" ||
        businessCase.current_stage === "Technical Review" ||
        businessCase.current_stage === "Engineering Review" ||
        businessCase.current_stage === "Engineering";
      const isPendingEngMgr =
        businessCase.workflow_status === "Pending Engineering Manager" ||
        businessCase.current_stage === "Engineering Approval";

      const isLegal = isLegalManagerRole(rawRole) || emailLower.includes("legal");
      const isPendingLegal =
        businessCase.workflow_status === "Pending Legal" ||
        businessCase.workflow_status === "Pending Legal Review" ||
        businessCase.current_stage === "Legal Approval" ||
        businessCase.current_stage === "Legal Review" ||
        businessCase.current_stage === "Legal";

      if (isEngMgr && (isPendingEngMgr || rawRole === "engineering")) {
        setActiveTab("engineering_approval");
      } else if (isEngineer && (isPendingEngineering || rawRole.toLowerCase().includes("engineer"))) {
        setActiveTab("technical_review");
      } else if (isLegal && isPendingLegal) {
        setActiveTab("legal_review");
      }
    }
  }, [businessCase, displayBudget, user]);

  const latestEngineerReview = useMemo(() => {
    const history = businessCase?.approval_history || [];
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const stage = (entry.stage || "").toLowerCase();
      const role = (entry.role || entry.user_role || "").toLowerCase();
      const action = (entry.action || "").toLowerCase();
      if (
        stage.includes("engineer") ||
        role.includes("engineer") ||
        action.includes("review") ||
        action.includes("technical")
      ) {
        return entry;
      }
    }
    return null;
  }, [businessCase]);

  const standardLegalDocsFallback: LegalReviewDocItem[] = useMemo(() => [
    {
      name: "Technical Data Sheet",
      document_type: "Technical Document",
      uploaded_by: businessCase?.requester_name || businessCase?.business_owner || "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
    {
      name: "Quality Assurance Certificate",
      document_type: "Compliance Document",
      uploaded_by: "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
    {
      name: "Warranty & SLA",
      document_type: "Supplier Document",
      uploaded_by: businessCase?.requester_name || businessCase?.business_owner || "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
    {
      name: "FAT/SAT Plan",
      document_type: "Technical/Compliance",
      uploaded_by: "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
    {
      name: "CE / Regulatory Compliance Certificate",
      document_type: "Compliance Document",
      uploaded_by: "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
    {
      name: "Installation, Commissioning & Operation Manual",
      document_type: "Supporting Document",
      uploaded_by: "Department User",
      uploaded_date: businessCase?.created_date || new Date().toISOString(),
      version: "v1",
      status: "Pending Review",
    },
  ], [businessCase]);

  const legalReviewDocs = useMemo<LegalReviewDocItem[]>(() => {
    const docs: LegalReviewDocItem[] = [];
    const sourceAttachments = [
      ...(businessCase?.supporting_documents || []),
      ...(businessCase?.documents || []),
      ...(businessCase?.attachments || []),
      ...(need?.attachments || []),
    ];

    const seen = new Set<string>();
    for (const rawDoc of sourceAttachments) {
      const d = rawDoc as any;
      if (!d) continue;
      const docName = d.name || d.document_name || d.file_name || d.fileName;
      if (!docName) continue;
      const key = String(docName).toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);

      docs.push({
        id: d.id || `doc-${docs.length + 1}`,
        name: docName,
        document_type: d.category || d.document_type || "Supporting Document",
        uploaded_by: d.uploaded_by || businessCase?.requester_name || businessCase?.business_owner || "Department User",
        uploaded_date: d.uploaded_on || d.date || businessCase?.created_date || new Date().toISOString(),
        version: d.version || "v1",
        status: (d.status as any) || "Pending Review",
        file_url: d.file_url || d.url,
        file_id: d.file_id,
        size: d.size,
      });
    }

    // Only fallback if no attachments were ever uploaded/present
    if (docs.length === 0) {
      for (const std of standardLegalDocsFallback) {
        docs.push(std);
      }
    }

    return docs.map((doc) => {
      const override = docReviewStatuses[doc.name];
      if (override) {
        return {
          ...doc,
          status: override.status,
          clarification_comment: override.comment,
          reviewed_by: (override as any).reviewed_by,
          reviewed_at: (override as any).reviewed_at,
        };
      }
      return doc;
    });
  }, [businessCase, need, standardLegalDocsFallback, docReviewStatuses]);

  const legalDocsList = useMemo(() => {
    const filtered = legalReviewDocs.filter((doc) => {
      const t = (doc.document_type || "").toLowerCase();
      const n = (doc.name || "").toLowerCase();
      return (
        t.includes("compliance") ||
        t.includes("regulatory") ||
        t.includes("legal") ||
        t.includes("quality") ||
        n.includes("ce") ||
        n.includes("certificate") ||
        n.includes("regulatory") ||
        n.includes("compliance") ||
        n.includes("quality") ||
        n.includes("iso")
      );
    });
    return filtered.length > 0 ? filtered : legalReviewDocs.slice(0, Math.ceil(legalReviewDocs.length / 2));
  }, [legalReviewDocs]);

  const supplierDocsList = useMemo(() => {
    const filtered = legalReviewDocs.filter((doc) => !legalDocsList.includes(doc));
    return filtered.length > 0 ? filtered : legalReviewDocs;
  }, [legalReviewDocs, legalDocsList]);

  const isChecklistComplete = useMemo(() => {
    return (
      Boolean(legalChecklist.businessRequirements) &&
      Boolean(legalChecklist.supplierDocReviewed) &&
      Boolean(legalChecklist.complianceCertificates) &&
      Boolean(legalChecklist.regulatoryRequirements) &&
      Boolean(legalChecklist.contractualRequirements) &&
      Boolean(legalChecklist.warrantyLiabilityTerms) &&
      Boolean(legalChecklist.requiredLegalDocsAvailable) &&
      Boolean(legalChecklist.noUnresolvedExceptions) &&
      Boolean(legalChecklist.finalReviewCompleted)
    );
  }, [legalChecklist]);

  const checklistCompletedCount = useMemo(() => {
    return Object.values(legalChecklist).filter(Boolean).length;
  }, [legalChecklist]);

  const reviewedDocsCount = useMemo(() => {
    return legalReviewDocs.filter((d) => d.status === "Reviewed").length;
  }, [legalReviewDocs]);

  const allRequiredDocsReviewed = useMemo(() => {
    if (legalReviewDocs.length === 0) return true;
    return legalReviewDocs.every((d) => d.status === "Reviewed");
  }, [legalReviewDocs]);

  const hasBlockingClarifications = useMemo(() => {
    return legalReviewDocs.some(
      (d) => d.status === "Requires Clarification" || d.status === "Rejected"
    );
  }, [legalReviewDocs]);

  const canEsignAndApprove = isChecklistComplete && !hasBlockingClarifications && allRequiredDocsReviewed;

  const legalSigObj = useMemo(() => {
    if (!businessCase?.legal_signature) return null;
    if (typeof businessCase.legal_signature === "object") return businessCase.legal_signature;
    return { signatureName: businessCase.legal_signature, signedAt: businessCase.legal_approved_date };
  }, [businessCase?.legal_signature, businessCase?.legal_approved_date]);

  const techRequirementsList: TechnicalRequirementItem[] = useMemo(() => {
    if (!businessCase) return [];

    const rawSource: any =
      businessCase.technical_requirements_list ??
      (businessCase as any).technicalRequirements ??
      businessCase.technical_requirements;

    let list: any[] = [];
    if (Array.isArray(rawSource)) {
      list = rawSource;
    } else if (typeof rawSource === "string" && rawSource.trim()) {
      try {
        const parsed = JSON.parse(rawSource);
        if (Array.isArray(parsed)) {
          list = parsed;
        } else {
          list = [{
            requirement_type: "Product / Equipment",
            specification: rawSource.trim(),
            description: rawSource.trim(),
            quantity: 1,
            uom: "Nos.",
            unit: "Nos.",
            priority: "High",
            is_mandatory: true,
          }];
        }
      } catch {
        list = [{
          requirement_type: "Product / Equipment",
          specification: rawSource.trim(),
          description: rawSource.trim(),
          quantity: 1,
          uom: "Nos.",
          unit: "Nos.",
          priority: "High",
          is_mandatory: true,
        }];
      }
    }

    if (list.length > 0) {
      return list.map((tr: any) => {
        const qty = Number(tr.quantity) || Number(tr.annual_volume) || 1;
        const uomVal = (tr.uom || tr.unit || "Nos.") as any;
        const itemVal = tr.item || tr.requirement_type || "Product / Equipment";
        const specVal = tr.specification || tr.description || "";
        const descVal = tr.description || specVal || "";

        return {
          id: tr.id || tr.name || undefined,
          requirement_type: itemVal,
          item: itemVal,
          specification: specVal,
          description: descVal,
          quantity: qty,
          annual_volume: qty,
          uom: uomVal,
          unit: uomVal,
          priority: tr.priority || "High",
          is_mandatory: tr.is_mandatory !== undefined ? Boolean(tr.is_mandatory) : true,
          performance_requirements: tr.performance_requirements || "",
          quality_requirements: tr.quality_requirements || "",
          delivery_installation_requirements: tr.delivery_installation_requirements || "",
          integration_requirements: tr.integration_requirements || "",
          safety_compliance_requirements: tr.safety_compliance_requirements || "",
          required_supplier_documents: Array.isArray(tr.required_supplier_documents)
            ? tr.required_supplier_documents
            : [],
          procurement_type: tr.procurement_type || "Material",
        };
      });
    }

    // Fallback if businessCase has title or technical_specifications
    if (businessCase.title || businessCase.technical_specifications) {
      return [
        {
          requirement_type: "Product / Equipment",
          item: businessCase.title,
          specification: businessCase.technical_specifications || "Industrial equipment / material specification compliant with plant standards.",
          description: businessCase.technical_specifications || businessCase.title || "",
          quantity: Number((businessCase as any).estimated_quantity) || Number(need?.estimated_quantity) || 1,
          annual_volume: Number((businessCase as any).estimated_quantity) || Number(need?.estimated_quantity) || 1,
          uom: ((businessCase as any).uom || (businessCase as any).unit || "Nos.") as any,
          unit: ((businessCase as any).uom || (businessCase as any).unit || "Nos.") as any,
          priority: (businessCase.priority as any) || "High",
          is_mandatory: true,
          performance_requirements: "Standard operating duty cycle, capacity, and MTBF parameters per plant engineering standards.",
          quality_requirements: "Full vendor quality certification, factory test reports, and compliance with ISO 9001 / IATF 16949.",
          delivery_installation_requirements: "Plant unloading, on-site commissioning, FAT/SAT, and validation sign-off.",
          integration_requirements: "Interfacing with existing factory utilities, power, SCADA/PLC controls, and plant floor layout.",
          safety_compliance_requirements: "OSHA machinery safety compliant, emergency stops, protective guarding, and safety interlocks.",
          required_supplier_documents: [
            "Technical Data Sheet / Specification Sheet",
            "Quality Assurance Certificate (ISO 9001 / IATF 16949)",
            "Safety Data Sheet (SDS) / Compliance Certificate",
            "Factory Acceptance Test (FAT) / SAT Plan",
          ],
        },
      ];
    }

    return [];
  }, [businessCase, need]);

  const technicalItems: TechnicalRequirementItem[] = techRequirementsList;

  const engineerReviewRecord = useMemo(() => {
    if (!businessCase?.approval_history) return null;
    return businessCase.approval_history.find(
      (h) =>
        h.action === "Technical Review Completed" ||
        h.action?.toLowerCase().includes("technical review") ||
        (h.role?.toLowerCase() === "engineer" && h.action?.toLowerCase().includes("review"))
    );
  }, [businessCase?.approval_history]);

  const isTechnicalReviewCompleted = useMemo(() => {
    if (!businessCase) return false;
    if (engineerReviewRecord) return true;
    const st = businessCase.workflow_status;
    return (
      st !== "Pending Engineering" &&
      st !== "Pending Technical Review" &&
      st !== "Submitted" &&
      st !== "Draft" &&
      st !== "Returned"
    );
  }, [businessCase, engineerReviewRecord]);

  const saveFinancialsMutation = useMutation({
    mutationFn: async () => {
      if (!businessCase) return;
      return saveBusinessCaseFinancials(businessCase.business_case_id || businessCase.name, {
        capex: finCapex === "" ? 0 : Number(finCapex),
        opex: finOpex === "" ? 0 : Number(finOpex),
        expected_annual_savings: finSavings === "" ? 0 : Number(finSavings),
        revenue_increase: finRevenue === "" ? 0 : Number(finRevenue),
        cost_avoidance: finCostAvoid === "" ? 0 : Number(finCostAvoid),
        project_duration: finDuration === "" ? 5 : Number(finDuration),
        discount_rate: finDiscountRate === "" ? 10 : Number(finDiscountRate),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      setFinSuccessMsg("Financial calculations updated and saved.");
      setFinErrorMsg("");
      toast.success("Financial metrics successfully recalculated and saved!");
      setTimeout(() => setFinSuccessMsg(""), 4000);
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message || "Failed to calculate and save financials.";
      setFinErrorMsg(msg);
      toast.error(msg);
    },
  });

  const effectiveCashFlows = useMemo(() => {
    if (businessCase?.cash_flows && businessCase.cash_flows.length > 0) {
      return businessCase.cash_flows;
    }
    const c = Number(finCapex !== "" ? finCapex : businessCase?.capex ?? displayBudget);
    const o = Number(finOpex !== "" ? finOpex : businessCase?.opex ?? 0);
    const s = Number(finSavings !== "" ? finSavings : businessCase?.expected_annual_savings ?? 0);
    const r = Number(finRevenue !== "" ? finRevenue : businessCase?.revenue_increase ?? 0);
    const a = Number(finCostAvoid !== "" ? finCostAvoid : businessCase?.cost_avoidance ?? 0);
    const d = Number(finDuration !== "" ? finDuration : businessCase?.project_duration ?? 5);
    const dr = Number(finDiscountRate !== "" ? finDiscountRate : businessCase?.discount_rate ?? 10);

    const calc = calculateBusinessCaseFinancials({
      capex: c,
      opex: o,
      expected_annual_savings: s,
      revenue_increase: r,
      cost_avoidance: a,
      project_duration: d,
      discount_rate: dr,
    });
    return calc.cash_flows;
  }, [businessCase, displayBudget, finCapex, finOpex, finSavings, finRevenue, finCostAvoid, finDuration, finDiscountRate]);

  const userRole = (user?.role || "department").toLowerCase();
  const userEmail = user?.email || "user@netlink.com";

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-500 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-primary-600" />
          Loading Business Case details...
        </div>
      </div>
    );
  }

  if (!businessCase) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-white rounded-xl border border-neutral-200 shadow-sm">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-neutral-900">Business Case Not Found</h2>
        <p className="text-xs text-neutral-500 mt-1">The requested Business Case could not be located in ERPNext.</p>
        <Link
          to="/intake/business-cases"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Business Cases List
        </Link>
      </div>
    );
  }

  // ── Permission & Active Approver Computation (Sequential Gates) ───────────
  const status = businessCase.workflow_status;

  const canActEngineer =
    status === "Pending Engineering" &&
    (isEngineerRole(userRole) || userRole === "admin");

  const canActEngMgr =
    status === "Pending Engineering Manager" &&
    (isEngineeringManagerRole(userRole) || userRole === "admin");

  const canActFinance =
    (status === "Pending Finance" ||
      status === "Revision Required (Finance)" ||
      status === "Revision Required - Finance") &&
    (isFinanceManagerRole(userRole) || userRole === "admin");

  const canActLegal =
    (status === "Pending Legal" || status === "Pending Legal Review") &&
    businessCase.legal_status !== "Approved" &&
    (isLegalManagerRole(userRole) || userRole === "admin");

  const canActProcurement =
    status === "Pending Procurement" &&
    (isProcurementManagerRole(userRole) || userRole === "admin");

  const canCreateRfq =
    (status === "Approved" ||
      status === "Ready for RFQ" ||
      status === "Approved - Ready for RFQ" ||
      status === "Procurement Ready") &&
    (isProcurementManagerRole(userRole) || userRole === "admin") &&
    !businessCase.rfq_id;


  const canEditWhenReturned =
    (status === "Returned" || status === "Draft") &&
    (isDepartmentUserRole(userRole) || userRole === "admin" || businessCase.requester_email === userEmail);

  // Section-level write authorization
  const isFinanceMgr = isFinanceManagerRole(userRole) || userRole === "admin";
  const canEditFinancials =
    isFinanceMgr &&
    status !== "Approved" &&
    status !== "Ready for RFQ" &&
    status !== "Rejected";

  const canEditStrategy =
    (isProcurementManagerRole(userRole) || userRole === "admin") &&
    status !== "Approved" &&
    status !== "Ready for RFQ" &&
    status !== "Rejected";

  const canEditCompliance =
    (isLegalManagerRole(userRole) || userRole === "admin") &&
    status !== "Approved" &&
    status !== "Ready for RFQ" &&
    status !== "Rejected";

  // ── Sequential Approval Handlers ───────────────────────────────────────────
  const handleCompleteEngineerReview = async () => {
    if (!isEngineerChecklistComplete) {
      toast.error("Please complete all 9 mandatory checklist verification items before completing review.");
      return;
    }
    if (!commentText.trim()) {
      toast.error("Please enter Technical Review Notes / Assessment before completing review.");
      return;
    }

    setIsSubmittingAction(true);
    try {
      await completeEngineerTechnicalReview(
        businessCase.business_case_id,
        commentText.trim(),
        userEmail,
        userRole
      );
      toast.success("Technical Review complete. Case advanced to Engineering Manager Approval.");
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Technical review completion failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleApproveEngineering = async () => {
    setIsSubmittingAction(true);
    try {
      await approveEngineeringStage(
        businessCase.business_case_id,
        commentText || "Engineering specifications approved.",
        userEmail,
        userRole
      );
      toast.success("Engineering Stage approved. Case advanced to Finance Approval.");
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Engineering approval failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleApproveFinance = async () => {
    setIsSubmittingAction(true);
    try {
      await approveFinanceStage(
        businessCase.business_case_id,
        commentText || "Financials and budget verified.",
        userEmail,
        userRole,
        financeChecklist
      );
      toast.success("Finance Approval confirmed. Case advanced to Legal Approval.");
      setActionModal("none");
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Finance approval failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleApproveLegal = async (esignInfo?: {
    signatureName?: string;
    fontId?: LegalSignatureFontId;
    checklist?: Record<string, boolean>;
    documentReviews?: Record<string, { status: string; comment?: string }>;
  }) => {
    setIsSubmittingAction(true);
    try {
      const updatedCase = await approveLegalStage(
        businessCase.business_case_id,
        commentText || "Legal & compliance reviewed and approved.",
        userEmail,
        userRole,
        esignInfo
          ? {
              signatureName: esignInfo.signatureName || user?.name || "Legal Manager",
              fontId: esignInfo.fontId,
              signedAt: new Date().toISOString(),
              checklist: esignInfo.checklist || legalChecklist,
              documentReviews: esignInfo.documentReviews || docReviewStatuses,
              auditMetadata: {
                ipAddress: "127.0.0.1",
                userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "WebClient",
              },
            }
          : undefined,
      );
      toast.success("Legal approval completed successfully. Business Case moved to Procurement Review.");
      setCommentText("");
      if (updatedCase) {
        queryClient.setQueryData(["business-case", id], updatedCase);
      }
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Legal approval could not be completed. The Business Case remains in Legal Review.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleApproveProcurement = async () => {
    setIsSubmittingAction(true);
    try {
      await approveProcurementStage(
        businessCase.business_case_id,
        commentText || "Procurement strategy confirmed.",
        userEmail,
        userRole
      );
      toast.success("Procurement Review complete. Business Case is Ready for RFQ.");
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Procurement approval failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSendBackConfirm = async () => {
    if (!sendBackReason.trim()) {
      toast.error("Please enter a mandatory revision reason before sending back.");
      return;
    }
    setIsSubmittingAction(true);
    try {
      await sendBackBusinessCase(businessCase.business_case_id, sendBackReason, userEmail, userRole);
      toast.success(
        canActFinance
          ? "Business Case sent back for revision (Finance)."
          : "Business Case sent back to Requester (Returned)."
      );
      setActionModal("none");
      setSendBackReason("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Send back failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason.trim()) {
      toast.error("Please enter a mandatory rejection reason.");
      return;
    }
    setIsSubmittingAction(true);
    try {
      await rejectBusinessCase(businessCase.business_case_id, rejectReason, userEmail, userRole);
      toast.success("Business Case formally rejected.");
      setActionModal("none");
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rejection failed.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSaveStrategySection = async () => {
    try {
      await updateBusinessCaseSection(
        businessCase.business_case_id,
        "strategy",
        {
          procurement_type: strategyProcType,
          procurement_strategy: strategySourcing,
          procurement_justification: strategyNotes,
        },
        userEmail,
        userRole
      );
      toast.success("Procurement strategy section updated!");
      setInlineSection(null);
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update strategy section.");
    }
  };

  const handleSaveComplianceSection = async () => {
    try {
      await updateBusinessCaseSection(
        businessCase.business_case_id,
        "compliance",
        { compliance_notes: complianceNotes },
        userEmail,
        userRole
      );
      toast.success("Compliance section updated!");
      setInlineSection(null);
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update compliance section.");
    }
  };

  const handleCreateRfqSubmit = async () => {
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    await linkRfqToBusinessCase(
      businessCase.business_case_id,
      rfqNumber,
      userEmail,
      userRole
    );
    toast.success(`RFQ ${rfqNumber} successfully created and linked!`);
    queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    navigate(`/sourcing/rfq/${rfqNumber}`);
  };


  return (
    <div className={`business-case-detail-page w-full space-y-6 ${(canActFinance || canActLegal) ? "pb-28" : "pb-20"}`}>
      {/* Header Card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-xs">
        <Link
          to="/intake/business-cases"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-primary-700 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Business Cases
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              <span className="font-mono text-sm font-bold text-primary-700">{businessCase.business_case_id}</span>
              <IntakeApprovalBadge status={businessCase.workflow_status} size="md" />
              {businessCase.is_locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
                  <Lock className="h-3 w-3 text-neutral-500" />
                  Approved Record (Locked)
                </span>
              )}
              {businessCase.priority && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                    (businessCase.priority as string) === "Urgent" || businessCase.priority === "Critical"
                      ? "bg-red-100 text-red-700 border border-red-200"
                      : businessCase.priority === "High"
                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                      : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {businessCase.priority} Priority
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-lg sm:text-xl font-bold text-neutral-900 leading-tight">
              {businessCase.title}
            </h1>
            <p className="mt-1 text-xs text-neutral-500 leading-normal">
              Dept: <span className="font-semibold text-neutral-700">{businessCase.department}</span>
              {businessCase.plant && <> | Plant: <span className="font-semibold text-neutral-700">{businessCase.plant}</span></>}
              {businessCase.commodity && <> | Commodity: <span className="font-semibold text-neutral-700">{businessCase.commodity}</span></>}
              {" "}| Owner: <span className="font-semibold text-neutral-700">{businessCase.business_owner}</span>
              {" "}| Rev #{businessCase.revision_number || 1}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
            {canEditWhenReturned && (
              <Link
                to={`/intake/business-cases/${businessCase.business_case_id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition-colors"
              >
                <Edit3 className="h-4 w-4" />
                Edit & Resubmit Case
              </Link>
            )}

            {status === "Draft" && (
              <Link
                to={`/intake/business-cases/${businessCase.business_case_id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 transition-colors"
              >
                <Edit3 className="h-4 w-4" />
                Continue Editing Draft
              </Link>
            )}

            {canCreateRfq && (
              <button
                onClick={() => setIsRfqModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 cursor-pointer transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                Create RFQ
              </button>
            )}

            {businessCase.rfq_id && (
              <Link
                to={`/sourcing/rfq/${businessCase.rfq_id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3.5 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100 transition-colors"
              >
                <Sparkles className="h-4 w-4 text-indigo-600" />
                Linked RFQ: {businessCase.rfq_id}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Returned / Rejection Alert Banner */}
      {status === "Returned" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-sm text-amber-950">Business Case Returned for Revision</h4>
            <p className="mt-0.5">
              This case has been returned by the review committee. Required modifications must be made before resubmitting into the approval queue.
            </p>
            {businessCase.rejection_reason && (
              <div className="mt-2 p-2 rounded-lg bg-white/80 border border-amber-200 font-mono text-[11px] text-amber-950">
                <strong>Feedback:</strong> {businessCase.rejection_reason}
              </div>
            )}
            {canEditWhenReturned && (
              <div className="mt-2.5">
                <Link
                  to={`/intake/business-cases/${businessCase.business_case_id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 font-bold text-white shadow-xs hover:bg-amber-800"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Open Form in Edit Mode & Resubmit
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {status === "Rejected" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm text-red-950">Business Case Formally Rejected</h4>
            <p className="mt-0.5">
              This procurement case was not approved. Rationale: {businessCase.rejection_reason || "No specific reason logged."}
            </p>
          </div>
        </div>
      )}

      {canActEngineer && activeTab !== "technical_review" && (
        <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/50 to-white p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shrink-0">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-primary-950">
                Action Required: Technical Review (Engineer)
              </h3>
              <p className="text-[11px] sm:text-xs text-primary-800">
                Review engineering requirements, verify specifications, and complete technical review checklist.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("technical_review")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 cursor-pointer shrink-0"
          >
            <Wrench className="h-4 w-4" />
            Open Technical Review Workspace
          </button>
        </div>
      )}

      {canActEngMgr && (
        <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/50 to-white p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-primary-200 pb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-600 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-primary-950">
                  Action Required: Engineering Approval (Engineering Manager)
                </h3>
                <p className="text-[11px] sm:text-xs text-primary-800">
                  Approve engineering specifications and technical scope before advancing to Finance Manager.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-[11px] font-bold text-primary-800 border border-primary-200 shrink-0">
              Active Stage Gate
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-700 uppercase tracking-wider mb-1">
              Engineering Approval Comments
            </label>
            <textarea
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Enter engineering governance remarks or approval conditions..."
              className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleApproveEngineering}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSubmittingAction ? "Processing..." : "Approve Engineering"}
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("send_back")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Send Back (Revision)
              </button>
            </div>

            <button
              type="button"
              disabled={isSubmittingAction}
              onClick={() => setActionModal("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Reject Case
            </button>
          </div>
        </div>
      )}

      {canActLegal && (
        <div className="rounded-xl border-2 border-indigo-500 bg-linear-to-r from-indigo-50/90 via-sky-50/50 to-white p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-indigo-200 pb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <Scale className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-indigo-950 uppercase tracking-wide">
                  LEGAL APPROVAL
                </h3>
                <p className="text-[11px] sm:text-xs text-indigo-800">
                  Active Gate &bull; Assigned to: <strong>Legal Manager</strong>
                </p>
              </div>
            </div>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800 border border-indigo-200 shrink-0">
              Active Gate
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-700 uppercase tracking-wider mb-1">
              Legal Review Comments
            </label>
            <textarea
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Enter legal review comments..."
              className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("legal_review")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-800 cursor-pointer"
              >
                <Eye className="h-4 w-4" />
                Open Legal Review Workspace
              </button>

              <button
                type="button"
                disabled={isSubmittingAction || !canEsignAndApprove}
                onClick={() => {
                  if (!canEsignAndApprove) {
                    setActiveTab("legal_review");
                    toast("Please complete all 9 checklist items and review documents before E-Signing.", { icon: "ℹ️" });
                  } else {
                    setIsLegalEsignModalOpen(true);
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white shadow-xs cursor-pointer disabled:opacity-50 ${
                  canEsignAndApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-neutral-600 hover:bg-neutral-700"
                }`}
              >
                <PenLine className="h-4 w-4" />
                {isSubmittingAction ? "Processing..." : "Review & E-Sign"}
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("send_back")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Send Back
              </button>
            </div>

            <button
              type="button"
              disabled={isSubmittingAction}
              onClick={() => setActionModal("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </button>
          </div>
        </div>
      )}

      {canActProcurement && (
        <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/50 to-white p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-primary-200 pb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-600 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-primary-950">
                  Action Required: Procurement Review (Procurement Manager)
                </h3>
                <p className="text-[11px] sm:text-xs text-primary-800">
                  Complete procurement strategy validation. Approval marks the case as Ready for RFQ.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-[11px] font-bold text-primary-800 border border-primary-200 shrink-0">
              Active Stage Gate
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-700 uppercase tracking-wider mb-1">
              Procurement Review Remarks
            </label>
            <textarea
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Enter packaging notes or procurement instructions..."
              className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleApproveProcurement}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSubmittingAction ? "Processing..." : "Complete Procurement Review"}
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("send_back")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Send Back (Revision)
              </button>
            </div>

            <button
              type="button"
              disabled={isSubmittingAction}
              onClick={() => setActionModal("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Reject Case
            </button>
          </div>
        </div>
      )}

      {/* Workflow Lifecycle Timeline */}
      <IntakeWorkflowTimeline need={need} businessCase={businessCase} />

      {/* Summary KPI Cards (Suppressed for Engineer to focus on Technical Review) */}
      {!(isEngineerRole(userRole) || canActEngineer || activeTab === "technical_review") && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              Total Budget ({displayCurrency})
            </span>
            <p className="text-base sm:text-lg font-bold text-neutral-900 truncate">
              {displayBudget > 0 ? formatCurrency(displayBudget) : <span className="text-neutral-400 text-sm font-normal">Not set</span>}
            </p>
          </div>
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              CAPEX / OPEX
            </span>
            <p className="text-xs sm:text-sm font-bold text-neutral-800 truncate">
              {businessCase.capex > 0 || businessCase.opex > 0
                ? `${formatCurrency(businessCase.capex)} / ${formatCurrency(businessCase.opex)}`
                : <span className="text-neutral-400 font-normal">Not set</span>}
            </p>
          </div>
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              Expected ROI
            </span>
            <p className="text-base sm:text-lg font-bold text-emerald-600 truncate">
              {businessCase.roi > 0 ? `${businessCase.roi}%` : <span className="text-neutral-400 text-sm font-normal">0%</span>}
            </p>
          </div>
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              NPV / IRR
            </span>
            <p className="text-xs sm:text-sm font-bold text-primary-900 truncate">
              {businessCase.npv > 0 || businessCase.irr > 0
                ? `${formatCurrency(businessCase.npv)} (${businessCase.irr}%)`
                : <span className="text-neutral-400 font-normal">Not set</span>}
            </p>
          </div>
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              Payback Period
            </span>
            <p className="text-xs sm:text-sm font-bold text-neutral-900 truncate">
              {businessCase.payback_period && businessCase.payback_period !== "Not provided" && businessCase.payback_period !== "Standard"
                ? businessCase.payback_period
                : "Calculated"}
            </p>
          </div>
          <div className="h-[88px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xs flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 truncate block">
              Annual Benefit
            </span>
            <p className="text-base sm:text-lg font-bold text-indigo-700 truncate">
              {(businessCase.expected_annual_savings ?? 0) > 0 || (businessCase.expected_savings ?? 0) > 0
                ? formatCurrency(businessCase.expected_annual_savings || businessCase.expected_savings || 0)
                : <span className="text-neutral-400 text-sm font-normal">$0</span>}
            </p>
          </div>
        </div>
      )}

      {/* ── FINANCE REVIEW SUMMARY (Immediate visibility for Finance Reviewer) ── */}
      {canActFinance && (
        <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/40 to-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-primary-200 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary-950">
                  Finance Review & Approval Summary
                </h3>
                <p className="text-xs text-primary-800">
                  Awaiting Finance Gate action. Review budget allocations, CAPEX/OPEX viability, and financial returns below.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-800 border border-primary-200">
              Active Gate: Finance Approval
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">Total Budget</span>
              <span className="text-sm font-bold text-neutral-900">{displayBudget > 0 ? formatCurrency(displayBudget) : "Not set"}</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">CAPEX / OPEX</span>
              <span className="text-sm font-bold text-neutral-900">{formatCurrency(businessCase.capex)} / {formatCurrency(businessCase.opex)}</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">Expected ROI</span>
              <span className="text-sm font-bold text-emerald-600">{businessCase.roi > 0 ? `${businessCase.roi}%` : "0%"}</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">NPV / IRR</span>
              <span className="text-sm font-bold text-primary-900">{businessCase.npv > 0 ? formatCurrency(businessCase.npv) : "$0"} ({businessCase.irr || 0}%)</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">Payback Period</span>
              <span className="text-sm font-bold text-neutral-900">{businessCase.payback_period || "Calculated"}</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-white p-2.5">
              <span className="text-[11px] font-semibold text-neutral-500 block uppercase">Annual Benefit</span>
              <span className="text-sm font-bold text-indigo-700">{formatCurrency(businessCase.expected_annual_savings || businessCase.expected_savings || 0)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1.5">
              Finance Comments / Approval Conditions
            </label>
            <textarea
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Enter finance notes, budget codes, or validation comments..."
              className="w-full rounded-lg border border-neutral-300 bg-white p-2.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
      )}

      {/* ── 14 ENTERPRISE WORKFLOW TABS ── */}
      <div>
        <div className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-neutral-200 bg-white/95 px-2 backdrop-blur-xs rounded-t-xl shadow-xs">
          <div
            ref={tabsContainerRef}
            className="flex h-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1 min-w-0 flex-1"
          >
            {[
              ...(isEngineeringManagerRole(userRole) || canActEngMgr || businessCase.workflow_status === "Pending Engineering Manager"
                ? [{ id: "engineering_approval", label: "🛡️ Engineering Approval Workspace" }]
                : []),
              { id: "technical_review", label: "🛠️ Technical Review Workspace" },
              { id: "overview", label: "1. Overview" },
              { id: "legal_review", label: "⚖️ Legal Review & E-Sign" },
              { id: "business_info", label: "2. Business Info" },
              { id: "justification", label: "3. Justification" },
              { id: "alternatives", label: "4. Alternatives" },
              { id: "financials", label: "5. Financials & ROI" },
              { id: "technical", label: "6. Technical Specs" },
              { id: "strategy", label: "7. Procurement Strategy" },
              { id: "review_gates", label: "8. Review Gates" },
              { id: "risk", label: "9. Risk Matrix" },
              { id: "compliance", label: "10. Compliance" },
              { id: "documents", label: `11. Documents (${legalReviewDocs.length})` },
              { id: "history", label: `12. Audit History (${businessCase.approval_history?.length || 0})` },
              { id: "rfq", label: `13. Sourcing RFQ (${businessCase.rfq_id ? "1" : "0"})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`h-8.5 px-3 text-xs font-semibold whitespace-nowrap rounded-md transition-colors cursor-pointer flex items-center shrink-0 ${
                  activeTab === tab.id
                    ? "bg-primary-50 text-primary-700 font-bold border border-primary-200 shadow-2xs"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Compact More Tabs Dropdown */}
          <div className="relative shrink-0 ml-2">
            <button
              type="button"
              onClick={() => setIsMoreTabsOpen(!isMoreTabsOpen)}
              className="inline-flex items-center gap-1 h-8 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 cursor-pointer transition-colors"
              title="All Tabs"
            >
              <span className="hidden sm:inline">All Tabs</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${isMoreTabsOpen ? "rotate-180" : ""}`} />
            </button>
            {isMoreTabsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsMoreTabsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-56 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg max-h-80 overflow-y-auto">
                  {[
                    ...(isEngineeringManagerRole(userRole) || canActEngMgr || businessCase.workflow_status === "Pending Engineering Manager"
                      ? [{ id: "engineering_approval", label: "🛡️ Engineering Approval Workspace" }]
                      : []),
                    { id: "technical_review", label: "🛠️ Technical Review Workspace" },
                    { id: "overview", label: "1. Overview" },
                    { id: "legal_review", label: "⚖️ Legal Review & E-Sign" },
                    { id: "business_info", label: "2. Business Info" },
                    { id: "justification", label: "3. Justification" },
                    { id: "alternatives", label: "4. Alternatives" },
                    { id: "financials", label: "5. Financials & ROI" },
                    { id: "technical", label: "6. Technical Specs" },
                    { id: "strategy", label: "7. Procurement Strategy" },
                    { id: "review_gates", label: "8. Review Gates" },
                    { id: "risk", label: "9. Risk Matrix" },
                    { id: "compliance", label: "10. Compliance" },
                    { id: "documents", label: `11. Documents (${legalReviewDocs.length})` },
                    { id: "history", label: `12. Audit History (${businessCase.approval_history?.length || 0})` },
                    { id: "rfq", label: `13. Sourcing RFQ (${businessCase.rfq_id ? "1" : "0"})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id as TabId);
                        setIsMoreTabsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-neutral-50 cursor-pointer ${
                        activeTab === tab.id ? "bg-primary-50 text-primary-700 font-bold" : "text-neutral-700"
                      }`}
                    >
                      <span className="truncate">{tab.label}</span>
                      {activeTab === tab.id && <Check className="h-3.5 w-3.5 text-primary-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="rounded-b-xl border border-t-0 border-neutral-200 bg-white p-5 sm:p-6 shadow-xs">
          {/* TAB: ENGINEERING APPROVAL WORKSPACE (Role-Specific for Engineering Manager) */}
          {activeTab === "engineering_approval" && (
            <div className="space-y-6">
              {/* PRIMARY ACTION SECTION / STAGE GATE BANNER */}
              <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/50 to-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-primary-200 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white shadow-xs">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary-700 bg-primary-100/70 border border-primary-200 px-2 py-0.5 rounded-full">
                          Action Required
                        </span>
                        <h2 className="text-base sm:text-lg font-bold text-primary-950">
                          Engineering Approval — Engineering Manager
                        </h2>
                      </div>
                      <p className="text-xs text-primary-800 mt-0.5">
                        Final engineering verification and approval for technically reviewed Business Cases.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-800 border border-primary-200 shadow-2xs">
                      <span className="h-2 w-2 rounded-full bg-primary-600 animate-pulse" />
                      Active Stage Gate
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 border border-neutral-200">
                      Stage: {businessCase.current_stage || "Engineering Approval"}
                    </span>
                    {businessCase.engineering_status === "Approved" && (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approved
                      </span>
                    )}
                  </div>
                </div>

                {/* Compact Context Metadata Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs pt-1">
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Business Case ID</span>
                    <span className="font-mono font-bold text-primary-900">{businessCase.business_case_id}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Current Status</span>
                    <span className="font-bold text-amber-700 truncate block">{businessCase.workflow_status}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Requester</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.requester_name || businessCase.business_owner}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Department</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.department}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Plant</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.plant || "Plant 01 - Main Manufacturing Hub"}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Technical Items</span>
                    <span className="font-bold text-neutral-900">{techRequirementsList.length} verified</span>
                  </div>
                </div>
              </div>

              {/* TECHNICAL REVIEW COMPLETED CALLOUT CARD */}
              <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50/40 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-200 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                          Technical Review Completed
                        </span>
                        <span className="text-xs text-neutral-500">
                          Reviewed by <strong className="text-neutral-800">{latestEngineerReview?.approver || "engineer@netlink.com"}</strong> on {formatDate(latestEngineerReview?.approved_on || businessCase.created_date)}
                        </span>
                      </div>
                      <p className="text-xs text-emerald-950 font-semibold mt-1">
                        "{latestEngineerReview?.comments || "Reviewed all technical requirements, specs, qty, UOM. Routing to Engineering Manager."}"
                      </p>
                    </div>
                  </div>
                </div>

                {/* Verified Technical Requirements & Scope */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                      Technical Requirements &amp; Verified Specifications
                    </h4>
                    <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                      {techRequirementsList.length} Technical Requirement{techRequirementsList.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {techRequirementsList.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center">
                      <FileText className="mx-auto h-7 w-7 text-neutral-400 mb-1" />
                      <p className="text-xs font-semibold text-neutral-600">No technical requirements were provided.</p>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {techRequirementsList.map((item, idx) => (
                        <div
                          key={item.id || `eng-mgr-req-${idx}`}
                          className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-2xs space-y-3"
                        >
                          {/* Item Top Metadata Row */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-neutral-100 pb-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white shadow-xs">
                                #{idx + 1}
                              </span>
                              <span className="rounded-md bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 border border-neutral-200">
                                {item.requirement_type || item.item || "Product / Equipment"}
                              </span>
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-bold border ${
                                  item.priority === "Critical"
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : item.priority === "High"
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-blue-50 text-blue-700 border-blue-200"
                                }`}
                              >
                                {item.priority || "High"} Priority
                              </span>
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                                  item.is_mandatory !== false
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-neutral-50 text-neutral-600 border-neutral-200"
                                }`}
                              >
                                {item.is_mandatory !== false ? "Mandatory" : "Optional"}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                <CheckCircle2 className="h-3 w-3" /> Technical Review Verified
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Quantity:</span>
                              <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-mono text-xs font-bold text-neutral-900 border border-neutral-200">
                                {item.quantity ?? 1} {item.uom || (item as any).unit || "Nos."}
                              </span>
                            </div>
                          </div>

                          {/* Item & Specification */}
                          <div>
                            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                              Item / Requirement &amp; Specification
                            </span>
                            <h4 className="text-sm font-bold text-neutral-900 mt-0.5">
                              {item.item || item.description || item.specification || businessCase.title}
                            </h4>
                            <p className="text-xs text-neutral-700 leading-relaxed font-medium mt-1">
                              {item.specification || item.description || "Technical specifications verified compliant with plant engineering standards."}
                            </p>
                          </div>

                          {/* 5-box Engineering Specifications Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs pt-1">
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 space-y-0.5">
                              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Performance</span>
                              <p className="text-neutral-800 text-[11px] leading-relaxed">
                                {item.performance_requirements || "Operational duty cycle and capacity verified per engineering standards."}
                              </p>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 space-y-0.5">
                              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Quality</span>
                              <p className="text-neutral-800 text-[11px] leading-relaxed">
                                {item.quality_requirements || "ISO 9001 / IATF 16949 quality assurance and factory test certificates verified."}
                              </p>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 space-y-0.5">
                              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Delivery</span>
                              <p className="text-neutral-800 text-[11px] leading-relaxed">
                                {item.delivery_installation_requirements || "Factory delivery, plant unloading, and commissioning sign-off verified."}
                              </p>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 space-y-0.5">
                              <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">Integration</span>
                              <p className="text-neutral-800 text-[11px] leading-relaxed">
                                {item.integration_requirements || "Factory utilities, power, and SCADA/PLC control integration verified."}
                              </p>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 space-y-0.5">
                              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Safety</span>
                              <p className="text-neutral-800 text-[11px] leading-relaxed">
                                {item.safety_compliance_requirements || "OSHA / CE machinery safety compliance and emergency stop interlocks verified."}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Attached Supporting Documents with PDF View */}
                {legalReviewDocs.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                      Technical Documents &amp; Attachments
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {legalReviewDocs.map((doc, dIdx) => (
                        <div key={dIdx} className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 bg-white shadow-2xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-red-500 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-neutral-900 truncate block" title={doc.name}>
                                {doc.name}
                              </span>
                              <span className="text-[10px] text-neutral-400">{doc.document_type}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenPdfPreview(doc.name, doc.document_type, resolveAttachmentUrl(doc), doc)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View File
                            </button>
                            <a
                              href={resolveAttachmentUrl(doc)}
                              download={doc.name}
                              onClick={async (e) => {
                                e.preventDefault();
                                const u = resolveAttachmentUrl(doc);
                                try {
                                  await openErpFileInBrowser(u, { fileName: doc.name, mode: "download" });
                                } catch {
                                  window.open(u, "_blank");
                                }
                              }}
                              className="text-neutral-400 hover:text-neutral-700 p-1"
                              title="Download File"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ACTION BAR FOR ENGINEERING MANAGER */}
              {canActEngMgr && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">
                      ENGINEERING APPROVAL
                    </h3>
                    <span className="text-[11px] font-semibold text-neutral-500">
                      Final engineering sign-off before financial gate
                    </span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Approval Comments
                    </label>
                    <textarea
                      rows={3}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Enter engineering approval comments, operational conditions, or governance remarks..."
                      className="w-full rounded-lg border border-neutral-300 bg-white p-3 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={handleApproveEngineering}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {isSubmittingAction ? "Processing..." : "Approve Engineering"}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={() => setActionModal("send_back")}
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Send Back
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={() => setActionModal("reject")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: TECHNICAL REVIEW WORKSPACE (Role-Specific for Engineer) */}
          {activeTab === "technical_review" && (
            <div className="space-y-6">
              {/* PRIMARY ACTION SECTION / STAGE GATE BANNER */}
              <div className="rounded-xl border-2 border-primary-500 bg-linear-to-r from-primary-50/90 via-sky-50/50 to-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-primary-200 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white shadow-xs">
                      <Wrench className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary-700 bg-primary-100/70 border border-primary-200 px-2 py-0.5 rounded-full">
                          Action Required
                        </span>
                        <h2 className="text-base sm:text-lg font-bold text-primary-950">
                          Technical Review — Engineer
                        </h2>
                      </div>
                      <p className="text-xs text-primary-800 mt-0.5">
                        Review all technical requirements and technical specifications before routing this Business Case to Engineering Manager.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-800 border border-primary-200 shadow-2xs">
                      <span className="h-2 w-2 rounded-full bg-primary-600 animate-pulse" />
                      Active Stage Gate
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 border border-neutral-200">
                      Stage: {businessCase.current_stage || "Technical Review"}
                    </span>
                    {isTechnicalReviewCompleted && (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completed
                      </span>
                    )}
                  </div>
                </div>

                {/* Compact Context Metadata Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs pt-1">
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Business Case ID</span>
                    <span className="font-mono font-bold text-primary-900">{businessCase.business_case_id}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Current Status</span>
                    <span className="font-bold text-amber-700 truncate block">{businessCase.workflow_status}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Requester</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.requester_name || businessCase.business_owner}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Department</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.department}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Plant</span>
                    <span className="font-semibold text-neutral-800 truncate block">{businessCase.plant || "Unassigned"}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-primary-200/70 bg-white/90 shadow-2xs">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase block">Technical Items</span>
                    <span className="font-bold text-neutral-900">{technicalItems.length} item{technicalItems.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </div>

              {/* COMPLETED REVIEW AUDIT BANNER (When stage is past Pending Engineering) */}
              {isTechnicalReviewCompleted && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-4 text-xs text-emerald-950 space-y-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-sm text-emerald-950">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                      <span>Technical Review Formally Completed</span>
                    </div>
                    <span className="rounded-full bg-emerald-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900 border border-emerald-300">
                      Routed to Engineering Manager
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-neutral-700 pt-1">
                    <div>
                      <span className="text-neutral-500 font-medium">Verified by: </span>
                      <span className="font-semibold text-neutral-900">{engineerReviewRecord?.approver || userEmail || "Engineer"}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-medium">Completed on: </span>
                      <span className="font-semibold text-neutral-900">{formatDate(engineerReviewRecord?.approved_on || (businessCase as any).modified_date || (businessCase as any).modified || businessCase.created_date)}</span>
                    </div>
                  </div>
                  {engineerReviewRecord?.comments && (
                    <div className="mt-2 p-2.5 rounded-lg bg-white/80 border border-emerald-200 text-neutral-800 text-xs leading-relaxed">
                      <span className="font-bold text-emerald-900 block mb-0.5">Technical Assessment Notes:</span>
                      {engineerReviewRecord.comments}
                    </div>
                  )}
                  <p className="text-[11px] text-emerald-800 italic pt-1">
                    This Business Case has advanced to the next workflow stage. Technical review actions are locked and read-only.
                  </p>
                </div>
              )}

              {/* SECTION: TECHNICAL REQUIREMENTS — PRIMARY SECTION */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-primary-600" />
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-neutral-900">
                        Technical Requirements &amp; Specifications
                      </h3>
                      <p className="text-xs text-neutral-500">
                        Itemized engineering specifications, quantities, UOM, performance, safety, and operational criteria
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-3 py-1">
                    {technicalItems.length} Technical Requirement{technicalItems.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="space-y-4">
                  {technicalItems.map((item, idx) => (
                    <div
                      key={item.id || `tech-req-${idx}`}
                      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs space-y-4 hover:border-neutral-300 transition-colors"
                    >
                      {/* Top Header of Item Card */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-neutral-100 pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white shadow-xs">
                            #{idx + 1}
                          </span>
                          <span className="rounded-md bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 border border-neutral-200">
                            {item.requirement_type || "Product / Equipment"}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-bold border ${
                              item.priority === "Critical"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : item.priority === "High"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                          >
                            {item.priority || "Medium"} Priority
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                              item.is_mandatory !== false
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-neutral-50 text-neutral-600 border-neutral-200"
                            }`}
                          >
                            {item.is_mandatory !== false ? "Mandatory" : "Optional"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Quantity:</span>
                          <span className="rounded-lg bg-neutral-100 px-3 py-1 font-mono text-xs font-bold text-neutral-900 border border-neutral-200">
                            {item.quantity ?? 1} {item.uom || "Unit"}
                          </span>
                        </div>
                      </div>

                      {/* Item Name / Requirement Title */}
                      <div>
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Item / Requirement</span>
                        <h4 className="text-sm font-bold text-neutral-900 mt-0.5">
                          {item.item || item.description || item.specification || businessCase.title}
                        </h4>
                      </div>

                      {/* Technical Detail Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-primary-700 uppercase tracking-wider block">
                            Technical Specification
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.specification || "Standard industrial engineering specification."}
                          </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                            Performance Requirements
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.performance_requirements || "Operational duty cycle, throughput, and capacity per factory parameters."}
                          </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                            Quality Requirements
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.quality_requirements || "ISO 9001 quality assurance, incoming inspection, and factory test certification."}
                          </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
                            Delivery Requirements
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.delivery_installation_requirements || "Factory delivery, unloading, FAT/SAT, and plant commissioning sign-off."}
                          </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">
                            Integration Requirements
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.integration_requirements || "Compatibility with existing plant machinery, electrical feeds, and PLC/SCADA controls."}
                          </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 space-y-1">
                          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">
                            Safety Requirements
                          </span>
                          <p className="text-neutral-800 leading-relaxed font-medium">
                            {item.safety_compliance_requirements || "OSHA / CE machinery safety compliance, safety interlocks, and emergency stop circuits."}
                          </p>
                        </div>
                      </div>

                      {/* Technical Documents & Supporting Attachments */}
                      <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
                        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">
                          Technical Documents &amp; Compliance Files
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {(item.required_supplier_documents && item.required_supplier_documents.length > 0
                            ? item.required_supplier_documents
                            : [
                                "Technical Data Sheet / Specification Sheet",
                                "Quality Assurance Certificate (ISO 9001 / IATF 16949)",
                                "Safety Data Sheet (SDS) / Compliance Certificate",
                                "Factory Acceptance Test (FAT) / SAT Plan",
                              ]
                          ).map((docName, dIdx) => (
                            <span
                              key={dIdx}
                              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 border border-neutral-200"
                            >
                              <FileText className="h-3.5 w-3.5 text-primary-600" />
                              {docName}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION: ENGINEER REVIEW CHECKLIST */}
              <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                      <ListChecks className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900">
                        Technical Review Checklist
                      </h3>
                      <p className="text-xs text-neutral-500">
                        The Engineer cannot complete the review until all mandatory review items are completed.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold border ${
                        isEngineerChecklistComplete
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                      }`}
                    >
                      {ENGINEER_CHECKLIST_ITEMS.filter((i) => engineerChecklist[i.key]).length} of {ENGINEER_CHECKLIST_ITEMS.length} Verified ({engineerChecklistProgress}%)
                    </span>

                    {canActEngineer && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const all: Record<string, boolean> = {};
                            ENGINEER_CHECKLIST_ITEMS.forEach((i) => (all[i.key] = true));
                            setEngineerChecklist(all);
                            toast.success("All 9 verification checklist items checked.");
                          }}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const none: Record<string, boolean> = {};
                            ENGINEER_CHECKLIST_ITEMS.forEach((i) => (none[i.key] = false));
                            setEngineerChecklist(none);
                          }}
                          className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${engineerChecklistProgress}%` }}
                  />
                </div>

                {/* 9 Checklist Items Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                  {ENGINEER_CHECKLIST_ITEMS.map((item) => {
                    const checked = isTechnicalReviewCompleted ? true : Boolean(engineerChecklist[item.key]);
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer select-none ${
                          checked
                            ? "border-emerald-200 bg-emerald-50/50"
                            : "border-neutral-200 bg-neutral-50/50 hover:bg-neutral-100/60"
                        } ${!canActEngineer && !isTechnicalReviewCompleted ? "cursor-default" : ""}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!canActEngineer || isTechnicalReviewCompleted}
                          checked={checked}
                          onChange={(e) => {
                            if (!canActEngineer) return;
                            setEngineerChecklist((prev) => ({
                              ...prev,
                              [item.key]: e.target.checked,
                            }));
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold text-neutral-900 block leading-tight">
                            {item.label}
                          </span>
                          <span className="text-[11px] text-neutral-500 block mt-0.5 leading-snug">
                            {item.desc}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* SECTION: ENGINEER INPUT */}
              <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
                  <div>
                    <label className="text-sm font-bold text-neutral-900 block">
                      Technical Review Notes / Assessment <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Enter technical verification findings, specification confirmation, issues, deviations, or recommendations.
                    </p>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-mono">
                    {commentText.length} characters
                  </span>
                </div>

                <textarea
                  rows={4}
                  value={commentText}
                  disabled={!canActEngineer}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Enter technical verification findings, specification confirmation, issues, deviations, or recommendations..."
                  className="w-full rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-50 disabled:text-neutral-500 font-sans leading-relaxed"
                />

                {!canActEngineer && engineerReviewRecord?.comments && (
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 text-xs text-neutral-700">
                    <span className="font-bold text-neutral-900 block mb-0.5">Recorded Review Note:</span>
                    {engineerReviewRecord.comments}
                  </div>
                )}
              </div>

              {/* SECTION: ACTION BUTTONS (Only visible when Engineer can act at Pending Engineering) */}
              {canActEngineer && (
                <div className="sticky bottom-4 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border-2 border-primary-400 bg-white/95 p-4 shadow-xl backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={() => setActionModal("send_back")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Send Back
                    </button>

                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={() => setActionModal("reject")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject Case
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {!isEngineerChecklistComplete && (
                      <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Complete all 9 checklist items to proceed
                      </span>
                    )}
                    {isEngineerChecklistComplete && !commentText.trim() && (
                      <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Enter Technical Review Notes to proceed
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={isSubmittingAction || !isEngineerChecklistComplete || !commentText.trim()}
                      onClick={handleCompleteEngineerReview}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isSubmittingAction ? "Processing..." : "Complete Technical Review"}
                    </button>
                  </div>
                </div>
              )}

              {/* SECTION: BUSINESS CASE REFERENCE INFORMATION (Collapsible / Read-Only Context) */}
              <div className="pt-4 border-t border-neutral-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-900">
                      Business Case Reference Information
                    </h3>
                    <p className="text-xs text-neutral-500">
                      Complete Business Case background and reference data. Read-only context for technical evaluation.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setAllRefSections(true)}
                      className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                    >
                      Expand All
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllRefSections(false)}
                      className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                    >
                      Collapse All
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  {/* 1. Business Information */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("businessInfo")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-neutral-500" />
                        <span>1. Business Information &amp; Organizational Scope</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.businessInfo ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.businessInfo && (
                      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 bg-white border-t border-neutral-100">
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Company</span>
                          <span className="font-semibold text-neutral-800">{businessCase.company || "Default Company"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Department</span>
                          <span className="font-semibold text-neutral-800">{businessCase.department}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Plant</span>
                          <span className="font-semibold text-neutral-800">{businessCase.plant || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Business Unit</span>
                          <span className="font-semibold text-neutral-800">{businessCase.business_unit || "Operations"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Project Name / Code</span>
                          <span className="font-semibold text-neutral-800">{(businessCase as any).project_name || businessCase.project || need?.project_name || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Commodity</span>
                          <span className="font-semibold text-neutral-800">{businessCase.commodity || "General"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Required Delivery Date</span>
                          <span className="font-semibold text-neutral-800">{formatDate(businessCase.required_delivery_date || businessCase.created_date)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 uppercase block">Business Owner</span>
                          <span className="font-semibold text-neutral-800">{businessCase.business_owner}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Business Justification */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("justification")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-indigo-500" />
                        <span>2. Business Justification &amp; Impact</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.justification ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.justification && (
                      <div className="p-4 space-y-3 bg-white border-t border-neutral-100 leading-relaxed text-xs">
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Strategic Alignment &amp; Priority</span>
                          <p className="text-neutral-800 mt-0.5">{(businessCase as any).strategic_alignment || businessCase.strategic_importance || "Essential operational infrastructure procurement."}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Problem Statement</span>
                          <p className="text-neutral-800 mt-0.5">{businessCase.problem_statement || businessCase.why_procurement_required || businessCase.business_problem || "Procurement required to meet manufacturing throughput targets."}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Business Justification</span>
                          <p className="text-neutral-800 mt-0.5">{businessCase.business_justification || businessCase.why_procurement_required || businessCase.business_problem || "Business case verified and submitted by department owner."}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Expected Operational &amp; Financial Benefits</span>
                          <p className="text-neutral-800 mt-0.5">{(businessCase as any).expected_benefits || businessCase.operational_impact || businessCase.customer_impact || need?.expected_benefits || "Reduces machine downtime, improves production cycle time, and ensures compliance."}</p>
                        </div>
                        {((businessCase as any).risk_of_inaction || (businessCase as any).risk_of_delay) && (
                          <div>
                            <span className="text-[10px] font-bold text-neutral-500 uppercase block">Risk of Inaction</span>
                            <p className="text-neutral-800 mt-0.5">{(businessCase as any).risk_of_inaction || (businessCase as any).risk_of_delay}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 3. Alternatives */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("alternatives")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Scale className="h-4 w-4 text-neutral-500" />
                        <span>3. Alternatives Considered</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.alternatives ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.alternatives && (
                      <div className="p-4 bg-white border-t border-neutral-100 space-y-3">
                        {Array.isArray(businessCase.alternatives) && businessCase.alternatives.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {businessCase.alternatives.map((alt: any, aIdx: number) => {
                              const title = alt.title || alt.name || alt.alternative_name || `Alternative ${aIdx + 1}`;
                              const pros = alt.pros || alt.advantages || "";
                              const cons = alt.cons || alt.disadvantages || "";
                              const cost = alt.cost_implication || alt.estimated_cost || alt.cost || "";
                              const reason = alt.chosen_reason || alt.rejected_reason || alt.evaluation_notes || "";
                              return (
                                <div key={aIdx} className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/70 text-xs space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-neutral-900">{title}</span>
                                    {cost && <span className="font-mono text-[11px] font-semibold text-neutral-600">{typeof cost === "number" ? formatCurrency(cost) : cost}</span>}
                                  </div>
                                  {pros && <p className="text-emerald-700"><strong className="text-neutral-600 font-semibold">Pros:</strong> {pros}</p>}
                                  {cons && <p className="text-red-700"><strong className="text-neutral-600 font-semibold">Cons:</strong> {cons}</p>}
                                  {reason && <p className="text-neutral-700"><strong className="text-neutral-600 font-semibold">Outcome:</strong> {reason}</p>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-neutral-700 leading-relaxed text-xs">
                            {businessCase.alternatives_considered || (businessCase as any).current_supplier_limitation || "Commercial procurement alternatives, direct refurbishment, and status quo evaluated; competitive supplier RFP chosen as most cost-effective."}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 4. Financial & ROI */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("financials")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-emerald-600" />
                        <span>4. Financial &amp; ROI Overview (Reference)</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.financials ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.financials && (
                      <div className="p-4 bg-white border-t border-neutral-100">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50">
                            <span className="text-[10px] font-bold text-neutral-500 uppercase block">Total Budget</span>
                            <span className="font-bold text-neutral-900 text-sm">{displayBudget > 0 ? formatCurrency(displayBudget) : "N/A"}</span>
                          </div>
                          <div className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50">
                            <span className="text-[10px] font-bold text-neutral-500 uppercase block">CAPEX / OPEX</span>
                            <span className="font-semibold text-neutral-800">{formatCurrency(businessCase.capex)} / {formatCurrency(businessCase.opex)}</span>
                          </div>
                          <div className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50">
                            <span className="text-[10px] font-bold text-neutral-500 uppercase block">Expected ROI</span>
                            <span className="font-bold text-emerald-600">{businessCase.roi > 0 ? `${businessCase.roi}%` : "0%"}</span>
                          </div>
                          <div className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50">
                            <span className="text-[10px] font-bold text-neutral-500 uppercase block">Payback Period</span>
                            <span className="font-semibold text-neutral-800">{businessCase.payback_period || "Standard"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 5. Procurement Strategy */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("strategy")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-blue-600" />
                        <span>5. Procurement Strategy</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.strategy ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.strategy && (
                      <div className="p-4 bg-white border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Procurement Type</span>
                          <span className="font-semibold text-neutral-900">{businessCase.procurement_type || "Direct"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-neutral-500 uppercase block">Sourcing Method</span>
                          <span className="font-semibold text-neutral-900">{businessCase.procurement_strategy || "Competitive RFQ"}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 6. Risk & Compliance */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("risk")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span>6. Risk &amp; Compliance Summary</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.risk ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.risk && (
                      <div className="p-4 bg-white border-t border-neutral-100 space-y-2">
                        <p className="text-neutral-700 leading-relaxed">
                          {businessCase.compliance_notes || "Standard corporate compliance, factory safety protocols, and statutory standards apply."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 7. Documents */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("documents")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4 text-neutral-500" />
                        <span>7. Attached Documents ({legalReviewDocs.length})</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.documents ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.documents && (
                      <div className="p-4 bg-white border-t border-neutral-100 space-y-2">
                        {legalReviewDocs.map((doc, dIdx) => (
                          <div key={dIdx} className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-200 bg-neutral-50">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-neutral-500" />
                              <span className="font-semibold text-neutral-900">{doc.name}</span>
                              <span className="text-[10px] text-neutral-400">({doc.document_type})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenPdfPreview(doc.name, doc.document_type, resolveAttachmentUrl(doc), doc)}
                                className="text-xs font-semibold text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 cursor-pointer"
                              >
                                View File
                              </button>
                              <a
                                href={resolveAttachmentUrl(doc)}
                                download={doc.name}
                                onClick={async (e) => {
                                  e.preventDefault();
                                  const u = resolveAttachmentUrl(doc);
                                  try {
                                    await openErpFileInBrowser(u, { fileName: doc.name, mode: "download" });
                                  } catch {
                                    window.open(u, "_blank");
                                  }
                                }}
                                className="text-xs text-neutral-500 hover:text-neutral-800 p-1 rounded hover:bg-neutral-200/60 transition-colors"
                                title="Download File"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 8. Audit Trail */}
                  <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleRefSection("auditTrail")}
                      className="w-full flex items-center justify-between p-4 text-left font-bold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary-600" />
                        <span>8. Workflow Audit Trail ({businessCase.approval_history?.length || 0})</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${openRefSections.auditTrail ? "rotate-180" : ""}`} />
                    </button>
                    {openRefSections.auditTrail && (
                      <div className="p-4 bg-white border-t border-neutral-100 space-y-2">
                        {(businessCase.approval_history || []).length === 0 ? (
                          <p className="text-xs text-neutral-400 italic">No historical approvals logged yet.</p>
                        ) : (
                          businessCase.approval_history?.map((h, hIdx) => (
                            <div key={hIdx} className="flex items-start justify-between p-2.5 rounded-lg border border-neutral-200 bg-neutral-50 text-xs">
                              <div>
                                <span className="font-bold text-neutral-900">{h.action}</span>
                                <span className="text-neutral-500"> by {h.approver || h.role}</span>
                                {h.comments && <p className="text-neutral-600 mt-0.5 italic">"{h.comments}"</p>}
                              </div>
                              <span className="text-[11px] font-mono text-neutral-400">{formatDate(h.approved_on)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-4 sm:space-y-5">
              {/* AI Assistant Summary */}
              <div className="rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/70 via-purple-50/40 to-white p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider">AI Business Case Summary</h4>
                    <span className="text-[11px] text-indigo-700">Synthesized contextual assessment (Advisory only)</span>
                  </div>
                </div>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-800 border border-indigo-200">
                  AI Assistant
                </span>
              </div>
              <p className="text-xs text-neutral-700 leading-relaxed">
                {businessCase.business_justification ||
                  `Business Case for ${businessCase.title} submitted by ${businessCase.business_owner} (${businessCase.department}). Capital allocation of ${formatCurrency(displayBudget)} projected to yield ${businessCase.roi}% ROI with payback within ${businessCase.payback_period || "estimated timeline"}.`}
              </p>
            </div>

            {/* Quick Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-neutral-200 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase text-neutral-500 flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-neutral-400" />
                  Core Procurement Scope
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Case Type</span>
                    <span className="font-semibold text-neutral-800">{businessCase.case_type || "Standard Procurement"}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Commodity</span>
                    <span className="font-semibold text-neutral-800">{businessCase.commodity || "General"}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Department</span>
                    <span className="font-semibold text-neutral-800">{businessCase.department}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Plant / Facility</span>
                    <span className="font-semibold text-neutral-800">{businessCase.plant || "Main Campus"}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Cost Center</span>
                    <span className="font-mono text-neutral-800">{businessCase.cost_center || "CC-CORP"}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 text-[11px] block">Required Date</span>
                    <span className="font-semibold text-neutral-800">{formatDate(businessCase.required_delivery_date || businessCase.created_date)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase text-neutral-500 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-neutral-400" />
                  Stage Approvals Status
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50">
                    <span className="text-neutral-600">Technical Gate</span>
                    <span className={`font-bold ${businessCase.technical_status === "Approved" ? "text-emerald-600" : businessCase.technical_review_required === false ? "text-neutral-400" : "text-amber-600"}`}>
                      {businessCase.technical_review_required === false ? "Bypassed" : businessCase.technical_status || "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50">
                    <span className="text-neutral-600">Finance Gate</span>
                    <span className={`font-bold ${businessCase.finance_status === "Approved" ? "text-emerald-600" : "text-amber-600"}`}>
                      {businessCase.finance_status || "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50">
                    <span className="text-neutral-600">Procurement Strategy Gate</span>
                    <span className={`font-bold ${businessCase.procurement_status === "Approved" ? "text-emerald-600" : "text-amber-600"}`}>
                      {businessCase.procurement_status || "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50">
                    <span className="text-neutral-600">Legal Gate</span>
                    <span className={`font-bold ${businessCase.legal_status === "Approved" ? "text-emerald-600" : businessCase.legal_review_required === false ? "text-neutral-400" : "text-amber-600"}`}>
                      {businessCase.legal_review_required === false ? "Bypassed" : businessCase.legal_status || "Pending"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LEGAL REVIEW & E-SIGN */}
        {activeTab === "legal_review" && (
          <div className="space-y-6">
            {/* Header Banner */}
            <div className="rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/80 via-blue-50/40 to-white p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                    <Scale className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-indigo-950">
                      LEGAL REVIEW &amp; COMPLIANCE WORKSPACE
                    </h3>
                    <p className="text-xs text-indigo-800">
                      Mandatory Legal Stage Gate: Complete checklist, evaluate documents, and execute digital signature.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800 border border-indigo-200">
                    Stage: {businessCase.current_stage || "Legal Approval"}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold border ${
                      businessCase.legal_status === "Approved"
                        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                        : "bg-amber-100 text-amber-800 border-amber-200"
                    }`}
                  >
                    {businessCase.legal_status === "Approved" ? "Gate Approved" : "Awaiting Review"}
                  </span>
                  {businessCase.legal_signature && (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <FileCheck className="h-3.5 w-3.5" />
                      E-Signed
                    </span>
                  )}
                </div>
              </div>

              {/* Legal Snapshot */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs pt-1">
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Case ID</span>
                  <span className="font-mono font-bold text-indigo-900">{businessCase.business_case_id}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Department</span>
                  <span className="font-semibold text-slate-800 truncate block">{businessCase.department}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Total Budget</span>
                  <span className="font-bold text-slate-900">{displayBudget > 0 ? formatCurrency(displayBudget) : "Not set"}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Sourcing Strategy</span>
                  <span className="font-semibold text-slate-800 truncate block">{businessCase.procurement_strategy || "Competitive RFQ"}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Delivery Target</span>
                  <span className="font-semibold text-slate-800">{formatDate(businessCase.required_delivery_date || businessCase.created_date)}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-indigo-100 bg-white/90">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Governing Law</span>
                  <span className="font-semibold text-indigo-900">Standard Corporate</span>
                </div>
              </div>
            </div>

            {/* A. LEGAL REQUIREMENTS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                    A. Legal Requirements
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5">
                  Legal Governance
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Jurisdiction &amp; Governing Law</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">Delaware General Corporation Law / Standard Corporate</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Legal Risk Classification</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">Tier 1 &mdash; Standard Capital Expenditure</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Intellectual Property &amp; Ownership</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">Work-For-Hire / Full IP Assignment to Company</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Confidentiality &amp; NDA</span>
                  <span className="font-semibold text-emerald-700 mt-0.5 block">Active Corporate Mutual Non-Disclosure Agreement</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Limitation of Liability</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">100% Contract Value cap; uncapped for gross negligence</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Dispute Resolution</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">Binding Commercial Arbitration</span>
                </div>
              </div>

              {canEditCompliance && (
                <div className="pt-2 border-t border-neutral-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-neutral-700 uppercase">
                      Legal Requirements &amp; Covenants Notes
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveComplianceSection}
                      className="text-[11px] font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md px-2.5 py-1 cursor-pointer"
                    >
                      Save Legal Scope
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={complianceNotes}
                    onChange={(e) => setComplianceNotes(e.target.value)}
                    placeholder="Document specific legal requirements, covenants, or exceptions applicable to this purchase..."
                    className="w-full rounded-lg border border-neutral-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* B. COMPLIANCE REQUIREMENTS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                    B. Compliance Requirements
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                  Regulatory Adherence
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">CE Marking &amp; ISO Standards</span>
                    <span className="text-neutral-600 text-[11px]">CE Directives, ISO 9001 / ISO 14001 certified</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">Environmental Directives</span>
                    <span className="text-neutral-600 text-[11px]">RoHS &amp; REACH chemical compliance declared</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">Occupational Safety</span>
                    <span className="text-neutral-600 text-[11px]">OSHA &amp; Industrial machinery safety compliant</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">Export Control &amp; Sanctions</span>
                    <span className="text-neutral-600 text-[11px]">Clear &mdash; Verified against denied parties list</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">Statutory Regulatory Certificate</span>
                    <span className="text-neutral-600 text-[11px]">Active certificate on file in Business Case</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-neutral-900 block">Compliance Officer Assessment</span>
                    <span className="text-neutral-600 text-[11px]">No high-risk statutory violations identified</span>
                  </div>
                </div>
              </div>
            </div>

            {/* C. REQUIRED LEGAL DOCUMENTS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-neutral-900 flex items-center gap-2 uppercase tracking-wide">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    C. Required Legal Documents ({legalDocsList.length})
                  </h4>
                  <p className="text-xs text-neutral-500">
                    Statutory regulatory compliance certificates, quality assurance plans, and legal exhibits attached to this Business Case.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    legalDocsList.every(d => d.status === "Reviewed") && legalDocsList.length > 0
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}>
                    {legalDocsList.filter(d => d.status === "Reviewed").length} of {legalDocsList.length} Reviewed
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Document Name</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Uploaded By</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Version</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {legalDocsList.map((doc, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="p-3 font-semibold text-neutral-900 flex items-center gap-2">
                          <Paperclip className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                          <div className="min-w-0">
                            <span className="truncate max-w-xs block">{doc.name}</span>
                            {doc.size && <span className="text-[10px] text-neutral-400 font-normal">PDF &bull; {doc.size}</span>}
                          </div>
                        </td>
                        <td className="p-3 text-neutral-600">{doc.document_type}</td>
                        <td className="p-3 text-neutral-600">{doc.uploaded_by}</td>
                        <td className="p-3 text-neutral-600 whitespace-nowrap">{formatDate(doc.uploaded_date)}</td>
                        <td className="p-3 font-mono text-[11px] text-neutral-600">{doc.version}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                              doc.status === "Reviewed"
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : doc.status === "Requires Clarification"
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : doc.status === "Rejected"
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {doc.status === "Reviewed" && <CheckCircle2 className="h-3 w-3" />}
                            {doc.status === "Requires Clarification" && <MessageSquare className="h-3 w-3" />}
                            {doc.status}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewDoc(doc)}
                              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                              title="View document"
                            >
                              <Eye className="h-3 w-3 text-neutral-500" />
                              View
                            </button>

                            <a
                              href={doc.file_url ? getFullFileUrl(doc.file_url, doc.file_id) : "#"}
                              download={doc.name}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                              title="Download document"
                            >
                              <Download className="h-3 w-3 text-neutral-500" />
                              Download
                            </a>

                            {canActLegal && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDocReviewStatuses((prev) => ({
                                      ...prev,
                                      [doc.name]: {
                                        status: "Reviewed",
                                        reviewed_by: user?.email || "Legal Manager",
                                        reviewed_at: new Date().toISOString(),
                                      },
                                    }));
                                    toast.success(`Marked "${doc.name}" as Reviewed`);
                                  }}
                                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors ${
                                    doc.status === "Reviewed"
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                      : "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  }`}
                                  title="Mark Reviewed"
                                >
                                  <Check className="h-3 w-3" />
                                  Mark Reviewed
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setClarificationModalDoc(doc);
                                    setClarificationComment(doc.clarification_comment || "");
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
                                  title="Request Clarification"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  Clarification
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* D. SUPPLIER DOCUMENTS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-neutral-900 flex items-center gap-2 uppercase tracking-wide">
                    <FileText className="h-4 w-4 text-primary-600" />
                    D. Supplier Documents ({supplierDocsList.length})
                  </h4>
                  <p className="text-xs text-neutral-500">
                    Supplier technical specifications, warranty &amp; SLA frameworks, FAT/SAT protocols, and operating guides.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    supplierDocsList.every(d => d.status === "Reviewed") && supplierDocsList.length > 0
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}>
                    {supplierDocsList.filter(d => d.status === "Reviewed").length} of {supplierDocsList.length} Reviewed
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Document Name</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Uploaded By</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Version</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {supplierDocsList.map((doc, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="p-3 font-semibold text-neutral-900 flex items-center gap-2">
                          <Paperclip className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                          <div className="min-w-0">
                            <span className="truncate max-w-xs block">{doc.name}</span>
                            {doc.size && <span className="text-[10px] text-neutral-400 font-normal">PDF &bull; {doc.size}</span>}
                          </div>
                        </td>
                        <td className="p-3 text-neutral-600">{doc.document_type}</td>
                        <td className="p-3 text-neutral-600">{doc.uploaded_by}</td>
                        <td className="p-3 text-neutral-600 whitespace-nowrap">{formatDate(doc.uploaded_date)}</td>
                        <td className="p-3 font-mono text-[11px] text-neutral-600">{doc.version}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                              doc.status === "Reviewed"
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : doc.status === "Requires Clarification"
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : doc.status === "Rejected"
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {doc.status === "Reviewed" && <CheckCircle2 className="h-3 w-3" />}
                            {doc.status === "Requires Clarification" && <MessageSquare className="h-3 w-3" />}
                            {doc.status}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewDoc(doc)}
                              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                              title="View document"
                            >
                              <Eye className="h-3 w-3 text-neutral-500" />
                              View
                            </button>

                            <a
                              href={doc.file_url ? getFullFileUrl(doc.file_url, doc.file_id) : "#"}
                              download={doc.name}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                              title="Download document"
                            >
                              <Download className="h-3 w-3 text-neutral-500" />
                              Download
                            </a>

                            {canActLegal && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDocReviewStatuses((prev) => ({
                                      ...prev,
                                      [doc.name]: {
                                        status: "Reviewed",
                                        reviewed_by: user?.email || "Legal Manager",
                                        reviewed_at: new Date().toISOString(),
                                      },
                                    }));
                                    toast.success(`Marked "${doc.name}" as Reviewed`);
                                  }}
                                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors ${
                                    doc.status === "Reviewed"
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                      : "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  }`}
                                  title="Mark Reviewed"
                                >
                                  <Check className="h-3 w-3" />
                                  Mark Reviewed
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setClarificationModalDoc(doc);
                                    setClarificationComment(doc.clarification_comment || "");
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
                                  title="Request Clarification"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  Clarification
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Active Document Clarifications Log */}
            {hasBlockingClarifications && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Pending Document Clarifications (Action Required)</span>
                </div>
                <p className="text-amber-800">
                  The following documents have open clarification inquiries. E-Signature is held until clarifications are resolved or cleared:
                </p>
                <div className="space-y-1.5 pt-1">
                  {legalReviewDocs
                    .filter((d) => d.status === "Requires Clarification" || d.status === "Rejected")
                    .map((d, i) => (
                      <div key={i} className="p-2 rounded-lg bg-white/80 border border-amber-200 text-neutral-800 flex items-start justify-between gap-2">
                        <div>
                          <strong className="font-semibold text-neutral-900">{d.name}:</strong>{" "}
                          <span className="text-neutral-700">{d.clarification_comment || "Clarification requested."}</span>
                        </div>
                        {canActLegal && (
                          <button
                            type="button"
                            onClick={() => {
                              setDocReviewStatuses((prev) => ({
                                ...prev,
                                [d.name]: { status: "Reviewed" },
                              }));
                              toast.success(`Cleared clarification for "${d.name}"`);
                            }}
                            className="text-[11px] font-bold text-emerald-700 hover:underline shrink-0"
                          >
                            Resolve &amp; Mark Reviewed
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* E. CONTRACT / TERMS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                    E. Contract / Terms
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5">
                  Commercial &amp; Contractual Terms
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Procurement Sourcing Strategy</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">{businessCase.procurement_strategy || "Competitive RFQ"}</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Contracting Framework</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">Turnkey Capital Equipment Master Agreement</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Payment Terms</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">Milestone: 30% Advance, 60% SAT, 10% Final (Net 45)</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Warranty &amp; SLA Requirements</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">24 Months Comprehensive On-Site; 99.5% Uptime SLA</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Liquidated Damages for Delay</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">0.5% per week of delay capped at 10% total contract value</span>
                </div>
                <div className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Termination Terms</span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">30-Day notice for convenience; immediate for breach</span>
                </div>
              </div>
            </div>

            {/* F. LEGAL REVIEW CHECKLIST */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-5 w-5 text-indigo-600" />
                    <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                      F. Legal Review Checklist ({checklistCompletedCount}/9 Completed)
                    </h4>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    All 9 mandatory checklist items must be verified before electronic signature execution.
                  </p>
                </div>

                {canActLegal && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const allChecked: Record<string, boolean> = {};
                        for (const item of LEGAL_CHECKLIST_ITEMS) {
                          allChecked[item.key] = true;
                        }
                        setLegalChecklist(allChecked);
                        toast.success("All 9 checklist criteria verified!");
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Select All (All Passed)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const cleared: Record<string, boolean> = {};
                        for (const item of LEGAL_CHECKLIST_ITEMS) {
                          cleared[item.key] = false;
                        }
                        setLegalChecklist(cleared);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-neutral-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isChecklistComplete ? "bg-emerald-500" : "bg-indigo-600"
                  }`}
                  style={{ width: `${(checklistCompletedCount / 9) * 100}%` }}
                />
              </div>

              {/* Checklist Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {LEGAL_CHECKLIST_ITEMS.map((item, idx) => {
                  const isChecked = Boolean(legalChecklist[item.key]);
                  return (
                    <label
                      key={item.key}
                      className={`flex flex-col justify-between p-3.5 rounded-xl border transition-all ${
                        canActLegal ? "cursor-pointer" : "cursor-default"
                      } ${
                        isChecked
                          ? "border-emerald-300 bg-emerald-50/50 shadow-2xs"
                          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="text-xs font-bold text-neutral-900 flex items-center gap-2">
                            <input
                              type="checkbox"
                              disabled={!canActLegal}
                              checked={isChecked}
                              onChange={(e) => {
                                setLegalChecklist((prev) => ({
                                  ...prev,
                                  [item.key]: e.target.checked,
                                }));
                              }}
                              className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                            />
                            {idx + 1}. {item.label}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase shrink-0 ${
                              isChecked
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            {isChecked ? "Passed" : "Pending"}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-600 leading-snug pl-6">
                          {item.desc}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* G. LEGAL COMMENTS */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wide">
                    G. Legal Comments
                  </h4>
                </div>
                <span className="text-[11px] text-slate-500">
                  Recorded with User, Role, Date, Time, Case ID, and Stage
                </span>
              </div>
              <textarea
                rows={3}
                disabled={!canActLegal}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Enter legal review comments..."
                className="w-full rounded-lg border border-neutral-300 bg-white p-2.5 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-neutral-100"
              />
              {businessCase.legal_comments && (
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 text-xs">
                  <span className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">
                    Previous Legal Comment Log
                  </span>
                  <p className="text-neutral-800 italic">&ldquo;{businessCase.legal_comments}&rdquo;</p>
                  <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-1.5 font-mono">
                    <span>By: {businessCase.legal_approved_by || "Legal Manager"}</span>
                    <span>&bull;</span>
                    <span>Role: Legal Manager</span>
                    <span>&bull;</span>
                    <span>Stage: Legal Review</span>
                  </div>
                </div>
              )}
            </div>

            {/* H. E-SIGNATURE */}
            <div className="rounded-xl border-2 border-indigo-200 bg-linear-to-b from-indigo-50/40 via-white to-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
                <div className="flex items-center gap-2">
                  <PenLine className="h-5 w-5 text-indigo-600" />
                  <div>
                    <h4 className="text-sm font-bold text-indigo-950 uppercase tracking-wide">
                      H. E-Signature &amp; Legal Approval Decision
                    </h4>
                    <p className="text-xs text-indigo-800 mt-0.5">
                      {businessCase.legal_signature
                        ? "Legally certified record and binding approval."
                        : "Execute binding legal review and advance Business Case to Procurement Manager."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Requirement 11 Summary Card */}
              <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-2xs">
                <div className="text-xs font-bold uppercase tracking-wider text-indigo-950 mb-3 border-b border-indigo-100 pb-1.5">
                  LEGAL APPROVAL
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">Review complete:</span>
                    <span className="text-base font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                      {allRequiredDocsReviewed && isChecklistComplete ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" /> &check;
                        </span>
                      ) : (
                        <span className="text-amber-600">&times; Pending</span>
                      )}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">Documents reviewed:</span>
                    <span className="text-base font-bold text-slate-900 mt-1 font-mono">
                      {reviewedDocsCount} / {legalReviewDocs.length}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">Checklist:</span>
                    <span className={`text-base font-bold mt-1 block ${isChecklistComplete ? "text-emerald-600" : "text-amber-600"}`}>
                      {isChecklistComplete ? "Complete" : `${checklistCompletedCount} / 9 Criteria`}
                    </span>
                  </div>
                </div>
              </div>

              {legalSigObj ? (
                /* Already Signed Card */
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      DIGITALLY SIGNED &amp; APPROVED
                    </span>
                    <span className="text-[11px] font-mono text-emerald-800">
                      {formatDate(legalSigObj.signedAt || businessCase.legal_approved_date)}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl border border-emerald-200 bg-white text-center shadow-2xs">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 block">
                      Legal Signature Certificate
                    </span>
                    <p
                      className="text-2xl sm:text-3xl text-slate-900 mt-1"
                      style={{ fontFamily: "Caveat, cursive", lineHeight: 1.2 }}
                    >
                      {legalSigObj.signatureName || "Legal Manager"}
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-1 font-mono">
                      Role: Legal Manager | Stage: Approved &amp; Advanced to Procurement Manager
                    </p>
                  </div>
                </div>
              ) : canActLegal ? (
                /* Active Signer Controls */
                <div className="space-y-3">
                  {canEsignAndApprove ? (
                    <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs flex items-center gap-2.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                      <div>
                        <strong>All Required Documents Reviewed &amp; Checklist Verified ({reviewedDocsCount}/{legalReviewDocs.length} Reviewed, 9/9 Criteria Complete).</strong>
                        <p className="text-emerald-800 text-[11px] mt-0.5">
                          You are cleared to apply your electronic signature and approve this business case.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Action Required Before Signing:</strong>
                        <ul className="text-amber-800 text-[11px] mt-0.5 list-disc pl-4 space-y-0.5">
                          {!allRequiredDocsReviewed && (
                            <li>Review all {legalReviewDocs.length} required documents ({legalReviewDocs.length - reviewedDocsCount} remaining).</li>
                          )}
                          {!isChecklistComplete && (
                            <li>Complete all 9 checklist verification items ({9 - checklistCompletedCount} remaining).</li>
                          )}
                          {hasBlockingClarifications && (
                            <li>Resolve all pending document clarification inquiries.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isSubmittingAction || !canEsignAndApprove}
                        onClick={() => setIsLegalEsignModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                      >
                        <PenLine className="h-4 w-4" />
                        {isSubmittingAction ? "Processing..." : "Review & E-Sign"}
                      </button>

                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={() => setActionModal("send_back")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Send Back
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={() => setActionModal("reject")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-600 text-xs text-center">
                  Legal Stage Gate is sequential. It unlocks once Finance Manager completes budget verification and approval.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: BUSINESS INFO */}

        {/* TAB 2: BUSINESS INFO */}
        {activeTab === "business_info" && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Business & Organizational Classification
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Business Case ID</span>
                <span className="font-mono font-bold text-neutral-900 text-sm">{businessCase.business_case_id}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Case Type</span>
                <span className="font-semibold text-neutral-800">{businessCase.case_type || "Standard Procurement"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Priority</span>
                <span className="font-bold text-neutral-800">{businessCase.priority || "Medium"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Department</span>
                <span className="font-semibold text-neutral-800">{businessCase.department}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Plant / Location</span>
                <span className="font-semibold text-neutral-800">{businessCase.plant || "Main Facility"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Business Unit</span>
                <span className="font-semibold text-neutral-800">{businessCase.business_unit || "Operations"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Commodity</span>
                <span className="font-semibold text-neutral-800">{businessCase.commodity || "Direct Materials"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Cost Center</span>
                <span className="font-mono text-neutral-800">{businessCase.cost_center || "General CC"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">General Ledger Account</span>
                <span className="font-mono text-neutral-800">{businessCase.gl_account || "50000 - Operating Expenses"}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Requester Name & Email</span>
                <span className="font-semibold text-neutral-800">{businessCase.requester_name || businessCase.business_owner} ({businessCase.requester_email || "N/A"})</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Business Owner</span>
                <span className="font-semibold text-neutral-800">{businessCase.business_owner}</span>
              </div>
              <div className="p-3.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
                <span className="text-neutral-400 text-[11px] block">Required Delivery Date</span>
                <span className="font-semibold text-neutral-800">{formatDate(businessCase.required_delivery_date || businessCase.created_date)}</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: JUSTIFICATION */}
        {activeTab === "justification" && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Business Problem, Impact & Strategic Justification
            </h3>
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50">
                <span className="font-bold text-neutral-700 block mb-1">Why is this procurement required?</span>
                <p className="text-neutral-800 leading-relaxed">{businessCase.business_justification || "No justification provided."}</p>
              </div>

              <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50">
                <span className="font-bold text-neutral-700 block mb-1">Business Problem Solved</span>
                <p className="text-neutral-800 leading-relaxed">{businessCase.problem_statement || "No specific problem statement provided."}</p>
              </div>

              <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50">
                <span className="font-bold text-neutral-700 block mb-1">Current Limitations & Pain Points</span>
                <p className="text-neutral-800 leading-relaxed">{businessCase.current_limitations || "Existing operational bottlenecks and capacity limits."}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="font-bold text-neutral-700 block mb-1">Customer / Revenue Impact</span>
                  <p className="text-neutral-800 leading-relaxed">{businessCase.customer_impact || "Mitigates disruption risk and supports service level agreements."}</p>
                </div>
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="font-bold text-neutral-700 block mb-1">Strategic Importance</span>
                  <p className="text-neutral-800 leading-relaxed">{businessCase.strategic_importance || "High alignment with annual operational and procurement goals."}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ALTERNATIVES */}
        {activeTab === "alternatives" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <h3 className="text-sm font-bold text-neutral-900">
                Alternative Solutions & Trade-Off Analysis
              </h3>
            </div>

            {(!businessCase.alternatives || businessCase.alternatives.length === 0) ? (
              <div className="p-8 text-center text-xs text-neutral-500 border border-dashed rounded-xl">
                No formal alternatives table recorded. Standard single-option justification provided.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Option Name</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Estimated Cost</th>
                      <th className="p-3">Feasibility</th>
                      <th className="p-3">Rejection Reason / Trade-Off</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {businessCase.alternatives.map((alt, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50/60">
                        <td className="p-3 font-semibold text-neutral-900">{alt.name}</td>
                        <td className="p-3 text-neutral-700 max-w-xs">{alt.description}</td>
                        <td className="p-3 font-mono font-bold text-neutral-900">
                          {alt.estimated_cost ? formatCurrency(alt.estimated_cost) : "$0"}
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              alt.feasibility === "High"
                                ? "bg-emerald-100 text-emerald-800"
                                : alt.feasibility === "Medium"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-neutral-100 text-neutral-700"
                            }`}
                          >
                            {alt.feasibility || "Medium"}
                          </span>
                        </td>
                        <td className="p-3 text-neutral-600 max-w-xs">{alt.rejection_reason || "Evaluated but not preferred."}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: FINANCIALS */}
        {activeTab === "financials" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200 pb-3 gap-2">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Financial Assumptions & Deterministic ROI Model</h3>
                <p className="text-xs text-neutral-500">Live multi-year cash flow projections, Capex/Opex allocations, and net returns</p>
              </div>
              {canEditFinancials && (
                <button
                  onClick={() => saveFinancialsMutation.mutate()}
                  disabled={saveFinancialsMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 disabled:opacity-50 cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  {saveFinancialsMutation.isPending ? "Calculating..." : "Save Financials & Recalculate"}
                </button>
              )}
            </div>

            {finSuccessMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                {finSuccessMsg}
              </div>
            )}
            {finErrorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
                {finErrorMsg}
              </div>
            )}

            {/* Assumptions Form */}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-600">Assumptions & Cost Breakdown</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">CAPEX ($)</label>
                  <input
                    type="number"
                    value={finCapex}
                    onChange={(e) => setFinCapex(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">OPEX ($)</label>
                  <input
                    type="number"
                    value={finOpex}
                    onChange={(e) => setFinOpex(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Expected Annual Savings ($)</label>
                  <input
                    type="number"
                    value={finSavings}
                    onChange={(e) => setFinSavings(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Revenue Increase ($)</label>
                  <input
                    type="number"
                    value={finRevenue}
                    onChange={(e) => setFinRevenue(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Cost Avoidance ($)</label>
                  <input
                    type="number"
                    value={finCostAvoid}
                    onChange={(e) => setFinCostAvoid(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Project Duration (Years)</label>
                  <input
                    type="number"
                    value={finDuration}
                    onChange={(e) => setFinDuration(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Discount Rate (%)</label>
                  <input
                    type="number"
                    value={finDiscountRate}
                    onChange={(e) => setFinDiscountRate(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={!canEditFinancials}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs font-mono focus:border-primary-500 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
              </div>
            </div>

            {/* Cash Flow Projection Table */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-600 mb-2">Multi-Year Cash Flow Projection</h4>
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Period</th>
                      <th className="p-3 text-right">Cash Outflow</th>
                      <th className="p-3 text-right">Cash Inflow / Benefit</th>
                      <th className="p-3 text-right">Net Cash Flow</th>
                      <th className="p-3 text-right">Cumulative Net</th>
                      <th className="p-3 text-right">Discounted Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 font-mono">
                    {effectiveCashFlows.map((cf) => {
                      const outflow = (cf as any).outflow ?? (cf.investment || cf.opex || 0);
                      const inflow = (cf as any).inflow ?? (cf.annual_gross_benefit || 0);
                      const net = (cf as any).net ?? (cf.annual_net_benefit || 0);
                      const cumulative = (cf as any).cumulative ?? (cf.cumulative_cash_flow || 0);
                      const discounted = (cf as any).discounted ?? (cf.discounted_cash_flow || 0);

                      return (
                        <tr key={cf.year} className="hover:bg-neutral-50/50">
                          <td className="p-3 font-semibold text-neutral-900 font-sans">
                            {cf.year === 0 ? "Year 0 (Initial)" : `Year ${cf.year}`}
                          </td>
                          <td className="p-3 text-right text-red-600">
                            {outflow > 0 ? `-${formatCurrency(outflow)}` : "$0"}
                          </td>
                          <td className="p-3 text-right text-emerald-600">
                            {inflow > 0 ? `+${formatCurrency(inflow)}` : "$0"}
                          </td>
                          <td className={`p-3 text-right font-bold ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {net >= 0 ? `+${formatCurrency(net)}` : `-${formatCurrency(Math.abs(net))}`}
                          </td>
                          <td className="p-3 text-right text-neutral-800">
                            {cumulative >= 0 ? formatCurrency(cumulative) : `(${formatCurrency(Math.abs(cumulative))})`}
                          </td>
                          <td className="p-3 text-right text-neutral-600">
                            {formatCurrency(discounted)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: TECHNICAL */}
        {activeTab === "technical" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Technical Scope & Functional Specifications</h3>
                <p className="text-xs text-neutral-500">Requirements defined for engineering sign-off and RFP drafting</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50 space-y-2">
              <span className="font-bold text-xs text-neutral-700 block uppercase">Scope of Work Summary</span>
              <p className="text-xs text-neutral-800 leading-relaxed">
                {businessCase.technical_specifications || "Detailed specifications required to be finalized prior to RFQ publication."}
              </p>
            </div>

            {/* Technical Requirements Editor/Viewer Component */}
            <TechnicalRequirementsEditor
              requirements={techRequirementsList}
              readOnly={!canActEngineer && !canActEngMgr && status !== "Draft" && status !== "Returned"}
            />
          </div>
        )}

        {/* TAB 7: STRATEGY */}
        {activeTab === "strategy" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Procurement & Sourcing Strategy</h3>
                <p className="text-xs text-neutral-500">Method of procurement, supplier market approach, and key timelines</p>
              </div>
              {canEditStrategy && inlineSection !== "strategy" && (
                <button
                  onClick={() => setInlineSection("strategy")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Strategy
                </button>
              )}
            </div>

            {inlineSection === "strategy" ? (
              <div className="rounded-xl border border-primary-300 bg-primary-50/30 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-semibold text-neutral-700 mb-1">Procurement Type</label>
                    <select
                      value={strategyProcType}
                      onChange={(e) => setStrategyProcType(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:outline-none"
                    >
                      <option value="Direct">Direct Material</option>
                      <option value="Indirect">Indirect Goods & Supplies</option>
                      <option value="Services">Professional Services</option>
                      <option value="Capex">Capital Expenditure (Capex)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-neutral-700 mb-1">Sourcing Strategy</label>
                    <select
                      value={strategySourcing}
                      onChange={(e) => setStrategySourcing(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:outline-none"
                    >
                      <option value="Competitive RFQ">Competitive RFQ (3+ Bids)</option>
                      <option value="Sole Source">Sole Source Justified</option>
                      <option value="Single Source">Single Source Pre-selected</option>
                      <option value="Framework Agreement">Framework / Call-off Agreement</option>
                      <option value="Reverse Auction">Dynamic Reverse Auction</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Strategy Justification & Market Notes</label>
                  <textarea
                    rows={3}
                    value={strategyNotes}
                    onChange={(e) => setStrategyNotes(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setInlineSection(null)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveStrategySection}
                    className="px-4 py-1.5 rounded-lg bg-primary-600 text-xs font-bold text-white hover:bg-primary-700 shadow-xs"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="text-neutral-400 text-[11px] block">Procurement Type</span>
                  <span className="font-semibold text-neutral-800">{businessCase.procurement_type || "Direct"}</span>
                </div>
                <div className="p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="text-neutral-400 text-[11px] block">Sourcing Method</span>
                  <span className="font-semibold text-neutral-800">{businessCase.procurement_strategy || "Competitive RFQ"}</span>
                </div>
                <div className="p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="text-neutral-400 text-[11px] block">Target RFQ Launch Date</span>
                  <span className="font-semibold text-neutral-800">{formatDate(businessCase.rfq_target_date || businessCase.required_delivery_date)}</span>
                </div>
                <div className="sm:col-span-2 lg:col-span-3 p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50">
                  <span className="text-neutral-400 text-[11px] block mb-1">Strategy Justification</span>
                  <p className="text-neutral-800 leading-relaxed">
                    {businessCase.procurement_justification || "Competitive sourcing across approved global supplier panel."}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 8: REVIEW GATES */}
        {activeTab === "review_gates" && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Conditional Review Gates & Dynamic Approval Route
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className={`p-4 rounded-xl border ${businessCase.technical_review_required !== false ? "border-blue-200 bg-blue-50/40" : "border-neutral-200 bg-neutral-50/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-neutral-900">Technical Gate</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${businessCase.technical_review_required !== false ? "bg-blue-100 text-blue-800" : "bg-neutral-200 text-neutral-600"}`}>
                    {businessCase.technical_review_required !== false ? "ACTIVE GATE" : "SKIPPED"}
                  </span>
                </div>
                <p className="text-neutral-600">
                  {businessCase.technical_review_required !== false
                    ? "Requires sign-off from Engineering Manager to validate specifications and tolerances."
                    : "Technical specifications marked as non-complex; review skipped."}
                </p>
              </div>

              <div className={`p-4 rounded-xl border ${businessCase.high_value_required !== false ? "border-purple-200 bg-purple-50/40" : "border-neutral-200 bg-neutral-50/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-neutral-900">Executive Finance Gate</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${businessCase.high_value_required !== false ? "bg-purple-100 text-purple-800" : "bg-neutral-200 text-neutral-600"}`}>
                    {businessCase.high_value_required !== false ? "ACTIVE GATE" : "SKIPPED"}
                  </span>
                </div>
                <p className="text-neutral-600">
                  {businessCase.high_value_required !== false
                    ? "Budget exceeds $100k enterprise threshold. Requires Finance Executive / CFO approval."
                    : "Spend is below high-value threshold."}
                </p>
              </div>

              <div className={`p-4 rounded-xl border ${businessCase.legal_review_required !== false ? "border-emerald-200 bg-emerald-50/40" : "border-neutral-200 bg-neutral-50/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-neutral-900">Legal & Compliance Gate</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${businessCase.legal_review_required !== false ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"}`}>
                    {businessCase.legal_review_required !== false ? "ACTIVE GATE" : "SKIPPED"}
                  </span>
                </div>
                <p className="text-neutral-600">
                  {businessCase.legal_review_required !== false
                    ? "Contains custom terms, IP transfer, or cross-border compliance. Requires Legal Manager sign-off."
                    : "Standard procurement terms apply; separate legal review skipped."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 9: RISK */}
        {activeTab === "risk" && (
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Enterprise Risk Assessment Matrix
            </h3>

            {(!businessCase.risk_matrix || businessCase.risk_matrix.length === 0) ? (
              <div className="p-8 text-center text-xs text-neutral-500 border border-dashed rounded-xl">
                No specific risk items identified. General operational controls apply.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Category</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Likelihood</th>
                      <th className="p-3">Impact</th>
                      <th className="p-3">Mitigation Strategy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {businessCase.risk_matrix.map((r, i) => (
                      <tr key={i} className="hover:bg-neutral-50/60">
                        <td className="p-3 font-semibold text-neutral-900">{r.category}</td>
                        <td className="p-3 text-neutral-700 max-w-xs">{r.description}</td>
                        <td className="p-3">
                          <span className="font-semibold text-neutral-800">{r.likelihood}</span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              r.impact === "High"
                                ? "bg-red-100 text-red-800"
                                : r.impact === "Medium"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {r.impact}
                          </span>
                        </td>
                        <td className="p-3 text-neutral-600 max-w-xs">{r.mitigation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 10: COMPLIANCE */}
        {activeTab === "compliance" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Regulatory, Environmental & Corporate Compliance</h3>
                <p className="text-xs text-neutral-500">Legal governance, safety, quality certifications, and ESG adherence</p>
              </div>
              {canEditCompliance && inlineSection !== "compliance" && (
                <button
                  onClick={() => setInlineSection("compliance")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Notes
                </button>
              )}
            </div>

            {inlineSection === "compliance" ? (
              <div className="rounded-xl border border-primary-300 bg-primary-50/30 p-4 space-y-3">
                <label className="block text-xs font-semibold text-neutral-700">Legal & Regulatory Compliance Sign-off Notes</label>
                <textarea
                  rows={4}
                  value={complianceNotes}
                  onChange={(e) => setComplianceNotes(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs focus:outline-none"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setInlineSection(null)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveComplianceSection}
                    className="px-4 py-1.5 rounded-lg bg-primary-600 text-xs font-bold text-white hover:bg-primary-700 shadow-xs"
                  >
                    Save Notes
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50 space-y-2">
                  <span className="font-bold text-neutral-800 block uppercase">Regulatory & Standards</span>
                  <p className="text-neutral-700">
                    {businessCase.compliance_notes || "All goods and services must comply with corporate vendor code of conduct, ISO 9001/14001 quality management guidelines, and applicable local labor regulations."}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50 space-y-2">
                  <span className="font-bold text-neutral-800 block uppercase">Data Security & Confidentiality</span>
                  <p className="text-neutral-700">
                    Non-Disclosure Agreements (NDA) and supplier information security policies enforce strict data privacy and proprietary intellectual property protection.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 11: DOCUMENTS */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Attached Supporting Documents & Specifications
            </h3>

            {(!businessCase.supporting_documents || businessCase.supporting_documents.length === 0) ? (
              <div className="p-8 text-center text-xs text-neutral-500 border border-dashed rounded-xl">
                No external document attachments recorded.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">File Name</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Uploaded By</th>
                      <th className="p-3">Date</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {businessCase.supporting_documents.map((doc, idx) => {
                      const docUrl = resolveAttachmentUrl(doc);
                      const displayName = doc.file_name || doc.fileName || doc.name;
                      return (
                        <tr key={idx} className="hover:bg-neutral-50/60">
                          <td className="p-3 font-semibold text-neutral-900 flex items-center gap-1.5">
                            <Paperclip className="h-3.5 w-3.5 text-neutral-400" />
                            {displayName}
                          </td>
                          <td className="p-3 text-neutral-600">{doc.category || "General"}</td>
                          <td className="p-3 text-neutral-600">{doc.uploaded_by || "Requester"}</td>
                          <td className="p-3 text-neutral-600">{formatDate(doc.uploaded_on || businessCase.created_date)}</td>
                          <td className="p-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => handleOpenPdfPreview(displayName, doc.category, docUrl, doc)}
                              className="inline-flex items-center gap-1 text-primary-600 font-semibold hover:underline cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </button>
                            <a
                              href={docUrl}
                              download={displayName}
                              onClick={async (e) => {
                                e.preventDefault();
                                try {
                                  await openErpFileInBrowser(docUrl, { fileName: displayName, mode: "download" });
                                } catch {
                                  window.open(docUrl, "_blank");
                                }
                              }}
                              className="inline-flex items-center gap-1 text-neutral-600 font-semibold hover:underline"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 12: HISTORY */}
        {activeTab === "history" && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Full Approval & Rejection Audit Trail
            </h3>

            {(!businessCase.approval_history || businessCase.approval_history.length === 0) ? (
              <p className="text-xs text-neutral-500">No formal audit entries recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Stage</th>
                      <th className="p-3">Approver</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Comments / Remarks</th>
                      <th className="p-3">Date</th>
                      <th className="p-3 font-mono">Rev #</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {businessCase.approval_history.map((h, i) => (
                      <tr key={i} className="hover:bg-neutral-50/50">
                        <td className="p-3 font-semibold text-neutral-900">{h.stage}</td>
                        <td className="p-3 text-neutral-800">{h.approver}</td>
                        <td className="p-3 font-mono text-[11px] text-neutral-600">{h.role}</td>
                        <td className="p-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              h.action === "Approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : h.action === "Returned" || h.action === "Revision Requested"
                                ? "bg-amber-100 text-amber-800"
                                : h.action === "Rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-neutral-100 text-neutral-700"
                            }`}
                          >
                            {h.action}
                          </span>
                        </td>
                        <td className="p-3 text-neutral-600 max-w-xs">{h.comments || "—"}</td>
                        <td className="p-3 text-neutral-500 whitespace-nowrap">
                          {new Date(h.approved_on).toLocaleString()}
                        </td>
                        <td className="p-3 font-mono">#{h.revision_number || 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 13: SOURCING RFQ */}
        {activeTab === "rfq" && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              Downstream Sourcing & RFQ Execution
            </h3>

            {businessCase.rfq_id ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 gap-3">
                <div>
                  <span className="font-mono text-sm font-bold text-indigo-900">{businessCase.rfq_id}</span>
                  <p className="text-xs text-neutral-600 mt-0.5">Linked sourcing RFQ initiated from this approved business case.</p>
                </div>
                <Link
                  to={`/sourcing/rfq/${businessCase.rfq_id}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs"
                >
                  Open RFQ Workspace
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            ) : canCreateRfq ? (
              <div className="p-6 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3 text-center sm:text-left sm:flex sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-bold text-emerald-950">Procurement Ready — Sourcing Unlocked</h4>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    This business case has completed all required approval gates and is ready for quotation solicitations.
                  </p>
                </div>
                <button
                  onClick={() => setIsRfqModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  Create RFQ
                </button>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500 border border-dashed rounded-xl">
                RFQ creation is unlocked once the Business Case passes all approval gates and reaches "Approved / Ready for RFQ" state.
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* RFQ Creation Modal */}
      <CreateRFQFromBusinessCaseModal
        isOpen={isRfqModalOpen}
        businessCase={businessCase}
        onClose={() => setIsRfqModalOpen(false)}
        onSubmit={handleCreateRfqSubmit}
      />

      {/* ── STICKY BOTTOM ACTION BAR FOR FINANCE MANAGER ── */}
      {canActFinance && (
        <div
          className="fixed bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur-sm shadow-[0_-4px_16px_rgba(0,0,0,0.08)] transition-[left] duration-300"
          style={{
            left: sidebarMode !== "drawer" ? sidebarOffset : 0,
            right: 0,
            height: 72,
          }}
        >
          <div className="flex h-full w-full items-center justify-between gap-4 px-6 lg:px-8">
            {/* Left: Status & prompt */}
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary-600" />
                Finance Review Required
              </h4>
              <p className="text-[11px] sm:text-xs text-neutral-500">
                Review budget, CAPEX/OPEX, and financial viability.
              </p>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("send_back")}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Send Back
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("reject")}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("approve")}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Approve & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STICKY BOTTOM ACTION BAR FOR LEGAL MANAGER ── */}
      {canActLegal && (
        <div
          className="fixed bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur-sm shadow-[0_-4px_16px_rgba(0,0,0,0.08)] transition-[left] duration-300"
          style={{
            left: sidebarMode !== "drawer" ? sidebarOffset : 0,
            right: 0,
            height: 72,
          }}
        >
          <div className="flex h-full w-full items-center justify-between gap-4 px-6 lg:px-8">
            {/* Left: Status & prompt */}
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                <Scale className="h-4 w-4 text-primary-600" />
                Legal Review &amp; Approval Required
              </h4>
              <p className="text-[11px] sm:text-xs text-neutral-500">
                Review legal requirements, compliance documents, contractual requirements and supporting documents.
              </p>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("send_back")}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Send Back
              </button>

              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setActionModal("reject")}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </button>

              <button
                type="button"
                disabled={isSubmittingAction || !canEsignAndApprove}
                onClick={() => {
                  if (!canEsignAndApprove) {
                    setActiveTab("legal_review");
                    toast("Please complete all 9 checklist criteria and review all documents before E-Signing.", { icon: "ℹ️" });
                  } else {
                    setIsLegalEsignModalOpen(true);
                  }
                }}
                className={`inline-flex h-9 items-center justify-center rounded-lg px-4 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                  canEsignAndApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-neutral-600 hover:bg-neutral-700"
                }`}
              >
                <PenLine className="h-3.5 w-3.5 mr-1.5" />
                Review &amp; E-Sign / Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legal E-Signature Modal */}
      <LegalESignModal
        open={isLegalEsignModalOpen}
        defaultFullName={user?.name || "Legal Manager"}
        caseId={businessCase.business_case_id}
        caseTitle={businessCase.title}
        roleLabel="Legal Manager"
        onClose={() => setIsLegalEsignModalOpen(false)}
        onContinue={async ({ typedName, fontId }) => {
          setIsLegalEsignModalOpen(false);
          await handleApproveLegal({
            signatureName: typedName,
            fontId,
            checklist: legalChecklist,
            documentReviews: docReviewStatuses,
          });
        }}
      />

      {/* Real In-App PDF Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/70 p-3 sm:p-6 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col h-[90vh]">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-5 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-neutral-900 truncate">{previewDoc.name}</h3>
                  <p className="text-xs text-neutral-500">
                    Type: <strong className="text-neutral-700">{previewDoc.document_type}</strong> | Status: <strong className={previewDoc.status === "Reviewed" ? "text-emerald-700" : "text-amber-700"}>{previewDoc.status}</strong>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewDoc.file_url && (
                  <a
                    href={getFullFileUrl(previewDoc.file_url, previewDoc.file_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                    title="Open in new window"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">New Tab</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 cursor-pointer"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Document Viewer Body: Real PDF / Image Viewer */}
            <div className="flex-1 bg-slate-900 overflow-hidden relative flex flex-col">
              {previewDoc && (previewDoc.file_url || (previewDoc as any).url) ? (
                isImageAttachment(previewDoc) ? (
                  <div className="w-full h-full flex items-center justify-center p-4 overflow-auto bg-neutral-900/10">
                    <img
                      src={resolveAttachmentUrl(previewDoc)}
                      alt={previewDoc.name}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                ) : (
                  <iframe
                    src={resolveAttachmentUrl(previewDoc)}
                    title={previewDoc.name}
                    className="w-full h-full border-0 bg-white"
                  />
                )
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-white space-y-3">
                  <FileText className="h-12 w-12 text-slate-400" />
                  <p className="text-sm font-semibold">Document Reference: {previewDoc.name}</p>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {previewDoc.document_type} ({previewDoc.version})
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer Toolbar */}
            <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-5 py-3.5">
              <a
                href={resolveAttachmentUrl(previewDoc) || "#"}
                download={previewDoc.name}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                >
                  Close Viewer
                </button>
                {canActLegal && (
                  <button
                    type="button"
                    onClick={() => {
                      setDocReviewStatuses((prev) => ({
                        ...prev,
                        [previewDoc.name]: {
                          status: "Reviewed",
                          reviewed_by: user?.email || "Legal Manager",
                          reviewed_at: new Date().toISOString(),
                        },
                      }));
                      toast.success(`Marked "${previewDoc.name}" as Reviewed`);
                      setPreviewDoc(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark as Reviewed
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Clarification Request Modal */}
      {clarificationModalDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <MessageSquare className="h-5 w-5 shrink-0" />
              <h3 className="text-base font-bold text-neutral-900">Request Document Clarification</h3>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Inquire regarding <strong>{clarificationModalDoc.name}</strong>. E-Signature will be held until clarification is resolved.
            </p>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Clarification Details / Question <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={4}
                value={clarificationComment}
                onChange={(e) => setClarificationComment(e.target.value)}
                placeholder="Explain what information or correction is required in this document..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setClarificationModalDoc(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!clarificationComment.trim()}
                onClick={() => {
                  setDocReviewStatuses((prev) => ({
                    ...prev,
                    [clarificationModalDoc.name]: {
                      status: "Requires Clarification",
                      comment: clarificationComment.trim(),
                    },
                  }));
                  toast.success(`Clarification inquiry saved for "${clarificationModalDoc.name}"`);
                  setClarificationModalDoc(null);
                  setClarificationComment("");
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                Submit Clarification Inquiry
              </button>
            </div>
          </div>
        </div>
      )}
      {actionModal === "approve" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold text-neutral-900">Approve Business Case?</h3>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Confirm financial approval for this business case. Upon approval, the case will immediately advance to the next sequential stage.
            </p>

            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-neutral-500">Case ID:</span>
                <span className="font-mono font-bold text-neutral-900">{businessCase.business_case_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Stage:</span>
                <span className="font-semibold text-amber-700">Finance Approval</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Next Stage:</span>
                <span className="font-semibold text-emerald-700">Legal Approval</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Total Budget:</span>
                <span className="font-bold text-neutral-900">{displayBudget > 0 ? formatCurrency(displayBudget) : "Not set"}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Approval Comments / Remarks (Optional)
              </label>
              <textarea
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Enter any conditions, ERP budget codes, or notes..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleApproveFinance}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingAction ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Back / Revision Modal */}
      {actionModal === "send_back" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-neutral-900">Send Business Case Back</h3>
            <p className="text-xs text-neutral-500">
              Specify the required updates or additional documentation needed. The requester will be notified to revise and resubmit.
            </p>
            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Reason for revision <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={4}
                value={sendBackReason}
                onChange={(e) => setSendBackReason(e.target.value)}
                placeholder="Detail the exact revisions required..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingAction || !sendBackReason.trim()}
                onClick={handleSendBackConfirm}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingAction ? "Processing..." : "Send Back"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {actionModal === "reject" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-neutral-900">Reject Business Case</h3>
            <p className="text-xs text-neutral-500">
              Provide formal rationale for rejecting this business case. This action will permanently close this submission.
            </p>
            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Rejection Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection rationale..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingAction || !rejectReason.trim()}
                onClick={handleRejectConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {isSubmittingAction ? "Processing..." : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated Binary Document Preview Modal */}
      <BusinessCasePdfPreviewModal
        isOpen={pdfPreviewModal.isOpen}
        fileName={pdfPreviewModal.fileName}
        caseId={businessCase.business_case_id}
        documentType={pdfPreviewModal.documentType}
        directUrl={pdfPreviewModal.directUrl}
        file={pdfPreviewModal.file}
        onClose={() => setPdfPreviewModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
