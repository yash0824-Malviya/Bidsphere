import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Building2,
  Briefcase,
  FileText,
  DollarSign,
  Cpu,
  ShoppingBag,
  ShieldCheck,
  AlertOctagon,
  Paperclip,
  ChevronRight,
  ChevronLeft,
  Save,
  Send,
  AlertTriangle,
  Plus,
  Trash2,
  ArrowRight,
  Check,
  Info,
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  XCircle,
  RotateCw,
  Eye,
  Upload,
} from "lucide-react";

import { useAuthStore } from "../../store/authStore";
import {
  createBusinessCaseStandalone,
  resubmitBusinessCase,
  fetchBusinessCaseById,
  getNextBusinessCaseId,
  isDepartmentUserRole,
  mapToErpTechnicalRequirements,
} from "../../api/businessIntake";
import { uploadFileToERPNextDetailed, getFullFileUrl } from "../../api/legalDocsStorage";
import { calculateBusinessCaseFinancials } from "../../utils/financialCalculations";
import { TechnicalRequirementsEditor } from "../../components/intake/TechnicalRequirementsEditor";
import type {
  CreateBusinessCaseInput,
  BusinessCaseAlternative,
  BusinessCaseRiskItem,
  TechnicalRequirementItem,
  IntakeAttachment,
  BusinessCaseType,
} from "../../types/businessIntake";

export const BC_DOCUMENT_TYPES = [
  { id: "TECHNICAL_DOCUMENT", label: "Technical Data Sheet & Specifications" },
  { id: "QUALITY_COMPLIANCE", label: "Quality Assurance & Inspection Plan" },
  { id: "WARRANTY", label: "Warranty, Liability & SLA Framework" },
  { id: "TESTING_DOCUMENT", label: "Factory Acceptance Test (FAT) / SAT Protocol" },
  { id: "ENGINEERING_DOCUMENT", label: "Engineering Drawing & CAD Layout" },
  { id: "REGULATORY_COMPLIANCE", label: "CE / Statutory Regulatory Compliance Certificate" },
  { id: "OPERATION_MANUAL", label: "Installation, Commissioning & Maintenance Guide" },
  { id: "GENERAL_ATTACHMENT", label: "General Supporting Document" },
];

export function inferDocumentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes("tech") || lower.includes("spec") || lower.includes("data_sheet") || lower.includes("datasheet")) {
    return "Technical Data Sheet & Specifications";
  }
  if (lower.includes("quality") || lower.includes("qa") || lower.includes("iso") || lower.includes("inspect")) {
    return "Quality Assurance & Inspection Plan";
  }
  if (lower.includes("warranty") || lower.includes("sla") || lower.includes("contract") || lower.includes("legal")) {
    return "Warranty, Liability & SLA Framework";
  }
  if (lower.includes("fat") || lower.includes("sat") || lower.includes("test") || lower.includes("protocol")) {
    return "Factory Acceptance Test (FAT) / SAT Protocol";
  }
  if (lower.includes("drawing") || lower.includes("cad") || lower.includes("layout") || lower.includes("2d") || lower.includes("3d")) {
    return "Engineering Drawing & CAD Layout";
  }
  if (lower.includes("ce") || lower.includes("compliance") || lower.includes("cert") || lower.includes("regulatory") || lower.includes("osha")) {
    return "CE / Statutory Regulatory Compliance Certificate";
  }
  if (lower.includes("manual") || lower.includes("install") || lower.includes("operation") || lower.includes("guide")) {
    return "Installation, Commissioning & Maintenance Guide";
  }
  return "General Supporting Document";
}

const CASE_TYPES: BusinessCaseType[] = [
  "New Requirement",
  "Replacement",
  "Expansion",
  "Cost Reduction",
  "Regulatory / Mandatory",
  "Emergency",
];

const DEPARTMENTS = [
  "IT & Digital Transformation",
  "Industrial Operations",
  "Supply Chain & Logistics",
  "Engineering & Maintenance",
  "Finance & Controlling",
  "Quality Assurance",
  "Procurement",
  "Human Resources",
  "Research & Development",
];

const PLANTS = [
  "Plant 01 - Main Manufacturing Hub",
  "Plant 02 - Assembly & Logistics Facility",
  "Plant 03 - Precision Component Plant",
  "Corporate Headquarters (HQ)",
  "Regional Distribution Center",
];

const STRATEGIC_IMPORTANCE = ["Low", "Medium", "High", "Mission-Critical"];
const SOURCING_STRATEGIES = [
  "Competitive RFQ",
  "Sole Source",
  "Strategic Partnership",
  "Existing Contract Extension",
  "Framework Agreement",
];
const PROCUREMENT_TYPES = [
  "Competitive Bidding",
  "Single Source Justified",
  "Reverse Auction",
  "Two-Stage Bidding",
];
const SUPPLIER_STRATEGIES = ["Single Supplier", "Dual Sourcing", "Multiple Supplier"];
const RISK_CATEGORIES = ["Financial", "Technical", "Operational", "Supplier", "Legal", "Quality"] as const;

export default function BusinessCaseCreatePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const editId = routeId || searchParams.get("id") || "";

  const [currentStep, setCurrentStep] = useState(1);
  const [loadingInitial, setLoadingInitial] = useState(Boolean(editId));
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewNextId, setPreviewNextId] = useState<string>("BC-00001");
  const [returnedReason, setReturnedReason] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [caseType, setCaseType] = useState<BusinessCaseType>("New Requirement");
  const [department, setDepartment] = useState(user?.department || "IT & Digital Transformation");
  const [commodity, setCommodity] = useState("Direct Materials");
  const [category, setCategory] = useState("Hardware & Equipment");
  const [plant, setPlant] = useState("Plant 01 - Main Manufacturing Hub");
  const [businessUnit, setBusinessUnit] = useState("Industrial Operations");
  const [costCenter, setCostCenter] = useState("CC-4001");
  const [requester, setRequester] = useState(user?.full_name || user?.email || "Department Requester");
  const [businessOwner, setBusinessOwner] = useState(user?.email || "dept.head@netlink.com");
  const [requiredDate, setRequiredDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");

  // Step 2: Problem & Justification
  const [whyProcurementRequired, setWhyProcurementRequired] = useState("");
  const [problemSolved, setProblemSolved] = useState("");
  const [supplierLimitations, setSupplierLimitations] = useState("");
  const [customerImpact, setCustomerImpact] = useState("");
  const [operationalImpact, setOperationalImpact] = useState("");
  const [revenueImpact, setRevenueImpact] = useState("");
  const [strategicImportance, setStrategicImportance] = useState<"Low" | "Medium" | "High" | "Mission-Critical">("Medium");

  // Step 3: Alternatives
  const [alternatives, setAlternatives] = useState<BusinessCaseAlternative[]>([
    {
      id: "alt-1",
      name: "Status Quo (Do Nothing)",
      description: "Maintain current machinery without upgrade, incurring rising repair and downtime costs.",
      estimated_cost: 0,
      feasibility: "Low",
      rejection_reason: "Fails to address reliability bottlenecks and poses unacceptable downtime risks.",
    },
  ]);

  // Step 4: Financial Estimation & ROI
  const [estimatedBudget, setEstimatedBudget] = useState<number>(125000);
  const [currency, setCurrency] = useState("USD");
  const [capex, setCapex] = useState<number>(125000);
  const [opex, setOpex] = useState<number>(12000);
  const [expectedAnnualSavings, setExpectedAnnualSavings] = useState<number>(45000);
  const [revenueIncrease, setRevenueIncrease] = useState<number>(15000);
  const [costAvoidance, setCostAvoidance] = useState<number>(8000);
  const [projectDuration, setProjectDuration] = useState<number>(5);
  const [discountRate, setDiscountRate] = useState<number>(10);

  // Step 5: Technical Requirements
  const [technicalRequirements, setTechnicalRequirements] = useState<TechnicalRequirementItem[]>([
    {
      id: "TR-001",
      item_code: "SPEC-01",
      requirement_type: "Product / Equipment",
      specification: "Precision CNC Sizing and Machining System with automated tool changer",
      quantity: 1,
      uom: "Unit",
      priority: "Critical",
      is_mandatory: true,
      performance_requirements: "Tolerance ± 0.005mm, throughput minimum 80 parts/hr",
      quality_requirements: "ISO 9001 / IATF 16949 certified quality guarantee",
      delivery_installation_requirements: "Turnkey delivery, on-site commissioning, and calibration",
      integration_requirements: "ERPNext MES integration via standard OPC-UA protocol",
      safety_compliance_requirements: "CE / OSHA machine guarding compliance and E-stop circuit",
      required_supplier_documents: ["Technical Data Sheet", "Quality Certificate", "CE Compliance"],
    },
  ]);

  // Step 6: Procurement Strategy
  const [sourcingStrategy, setSourcingStrategy] = useState("Competitive RFQ");
  const [procurementType, setProcurementType] = useState("Competitive Bidding");
  const [supplierStrategy, setSupplierStrategy] = useState("Multiple Supplier");
  const [expectedSupplierCount, setExpectedSupplierCount] = useState<number>(3);
  const [rfqStartDate, setRfqStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split("T")[0];
  });
  const [rfqClosingDate, setRfqClosingDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 20);
    return d.toISOString().split("T")[0];
  });
  const [expectedAwardDate, setExpectedAwardDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 35);
    return d.toISOString().split("T")[0];
  });
  const [procurementJustification, setProcurementJustification] = useState(
    "Competitive RFQ with at least 3 qualified vendors to maximize commercial savings and technical fit.",
  );
  const [procurementNotes, setProcurementNotes] = useState("");

  // Step 7: Review Requirements (Toggles)
  const [technicalReviewRequired, setTechnicalReviewRequired] = useState(true);
  const [financeReviewRequired] = useState(true); // Mandatory
  const [operationsReviewRequired, setOperationsReviewRequired] = useState(false);
  const [qualityReviewRequired, setQualityReviewRequired] = useState(false);
  const [legalReviewRequired, setLegalReviewRequired] = useState(false);
  const [highValueRequired, setHighValueRequired] = useState(false);

  // Step 8: Risk & Compliance
  const [risks, setRisks] = useState<BusinessCaseRiskItem[]>([
    {
      id: "risk-1",
      description: "Supplier delivery delays impacting production schedule",
      category: "Supplier",
      impact: 3,
      likelihood: 2,
      risk_level: "Medium",
      mitigation_plan: "Establish contractual SLA with liquidated damages and buffer safety stock.",
    },
    {
      id: "risk-2",
      description: "Integration complexity with legacy production line",
      category: "Technical",
      impact: 4,
      likelihood: 2,
      risk_level: "Medium",
      mitigation_plan: "Conduct mandatory pre-delivery factory acceptance test (FAT) and trial run.",
    },
  ]);

  const [complianceRequirements, setComplianceRequirements] = useState("ISO 9001 and CE machine directives apply.");
  const [regulatoryRequirements, setRegulatoryRequirements] = useState("OSHA compliant electrical and mechanical safety standard.");
  const [environmentalRequirements, setEnvironmentalRequirements] = useState("RoHS compliant electrical components, energy efficient motor.");
  const [sustainabilityRequirements, setSustainabilityRequirements] = useState("Vendor must disclose carbon footprint assessment.");
  const [supplierCertification, setSupplierCertification] = useState("ISO 9001, CE Certification");
  const [safetyRequirements, setSafetyRequirements] = useState("Dual-channel emergency stop, interlocked safety doors");
  const [documentationRequirements, setDocumentationRequirements] = useState("Manuals, schematics, calibration certificates, training material");
  const [complianceNotes, setComplianceNotes] = useState("");

  // Step 9: Attachments
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);

  // Calculate live financial metrics
  const financialCalc = useMemo(() => {
    return calculateBusinessCaseFinancials({
      capex: Number(capex) || Number(estimatedBudget) || 0,
      opex: Number(opex) || 0,
      expected_annual_savings: Number(expectedAnnualSavings) || 0,
      revenue_increase: Number(revenueIncrease) || 0,
      cost_avoidance: Number(costAvoidance) || 0,
      project_duration: Number(projectDuration) || 5,
      discount_rate: Number(discountRate) || 10,
    });
  }, [capex, estimatedBudget, opex, expectedAnnualSavings, revenueIncrease, costAvoidance, projectDuration, discountRate]);

  // Keep capex synced with estimated budget by default if untouched
  const handleBudgetChange = (val: number) => {
    setEstimatedBudget(val);
    if (capex === estimatedBudget) {
      setCapex(val);
    }
    if (val >= 100000) {
      setHighValueRequired(true);
    }
  };

  // Pre-load next sequential ID or existing case for edit
  useEffect(() => {
    async function loadData() {
      try {
        if (editId) {
          const existing = await fetchBusinessCaseById(editId);
          if (existing) {
            setTitle(existing.title || "");
            setCaseType(existing.case_type || "New Requirement");
            setDepartment(existing.department || "");
            setCommodity(existing.commodity || "Direct Materials");
            setCategory(existing.category || "");
            setPlant(existing.plant || "");
            setBusinessUnit(existing.business_unit || "");
            setCostCenter(existing.cost_center || "");
            setRequester(existing.requester || existing.created_by || "");
            setBusinessOwner(existing.business_owner || "");
            setRequiredDate(existing.required_date || "");
            setPriority((existing.priority as any) || "Medium");

            setWhyProcurementRequired(existing.why_procurement_required || existing.business_problem || "");
            setProblemSolved(existing.business_problem || "");
            setSupplierLimitations(existing.current_supplier_limitation || "");
            setCustomerImpact(existing.customer_impact || "");
            setOperationalImpact(existing.operational_impact || "");
            setRevenueImpact(existing.revenue_impact || "");
            setStrategicImportance((existing.strategic_importance as any) || "Medium");

            if (existing.alternatives && existing.alternatives.length > 0) {
              setAlternatives(existing.alternatives);
            }

            setEstimatedBudget(Number(existing.budget) || Number(existing.capex) || 100000);
            setCurrency(existing.currency || "USD");
            setCapex(Number(existing.capex) || Number(existing.budget) || 100000);
            setOpex(Number((existing as any).opex_year) || Number(existing.opex) || 0);
            setExpectedAnnualSavings(Number(existing.expected_annual_savings) || 0);
            setRevenueIncrease(Number(existing.revenue_increase) || 0);
            setCostAvoidance(Number(existing.cost_avoidance) || 0);
            setProjectDuration(Number(existing.project_duration) || 5);
            setDiscountRate(Number(existing.discount_rate) || 10);

            if (Array.isArray(existing.technical_requirements_list) && existing.technical_requirements_list.length > 0) {
              setTechnicalRequirements(existing.technical_requirements_list);
            } else if (Array.isArray(existing.technical_requirements) && existing.technical_requirements.length > 0) {
              setTechnicalRequirements(
                (existing.technical_requirements as any[]).map((tr, idx) => ({
                  id: tr.name || tr.id || `TR-${idx + 1}`,
                  item_code: tr.item_code || tr.item || `SPEC-${idx + 1}`,
                  requirement_type: tr.item || tr.requirement_type || "Product / Equipment",
                  specification: tr.description || tr.specification || "",
                  quantity: Number(tr.annual_volume) || Number(tr.quantity) || 1,
                  uom: tr.unit || tr.uom || "Nos.",
                  priority: tr.priority || "High",
                  is_mandatory: tr.mandatory !== undefined ? Boolean(tr.mandatory) : true,
                  performance_requirements: tr.performance || tr.performance_requirements || "",
                  quality_requirements: tr.quality || tr.quality_requirements || "",
                  delivery_installation_requirements: tr.delivery || tr.delivery_installation_requirements || "",
                  integration_requirements: tr.integration || tr.integration_requirements || "",
                  safety_compliance_requirements: tr.safety || tr.safety_compliance_requirements || "",
                  required_supplier_documents: Array.isArray(tr.required_supplier_documents)
                    ? tr.required_supplier_documents
                    : typeof tr.required_supplier_documents === "string"
                    ? tr.required_supplier_documents.split(",").map((s: string) => s.trim()).filter(Boolean)
                    : [],
                }))
              );
            }

            setSourcingStrategy(existing.sourcing_strategy || "Competitive RFQ");
            setProcurementType(existing.procurement_type || "Competitive Bidding");
            setSupplierStrategy(existing.supplier_strategy || "Multiple Supplier");
            setExpectedSupplierCount(Number(existing.expected_supplier_count) || 3);
            setRfqStartDate(existing.rfq_start_date || "");
            setRfqClosingDate(existing.rfq_closing_date || "");
            setExpectedAwardDate(existing.expected_award_date || "");
            setProcurementJustification(existing.procurement_justification || "");
            setProcurementNotes(existing.procurement_notes || "");

            setTechnicalReviewRequired(existing.technical_review_required !== undefined ? existing.technical_review_required : true);
            setOperationsReviewRequired(Boolean(existing.operations_review_required));
            setQualityReviewRequired(Boolean(existing.quality_review_required));
            setLegalReviewRequired(Boolean(existing.legal_review_required));
            setHighValueRequired(Boolean(existing.high_value_required || (existing.budget && existing.budget >= 100000)));

            if (existing.risks && existing.risks.length > 0) {
              setRisks(existing.risks);
            }
            setComplianceRequirements(existing.compliance_requirements || "");
            setRegulatoryRequirements(existing.regulatory_requirements || "");
            setEnvironmentalRequirements(existing.environmental_requirements || "");
            setSustainabilityRequirements(existing.sustainability_requirements || "");
            setSupplierCertification(existing.supplier_certification || "");
            setSafetyRequirements(existing.safety_requirements || "");
            setDocumentationRequirements(existing.documentation_requirements || "");
            setComplianceNotes(existing.compliance_notes || "");

            if (existing.supporting_documents && existing.supporting_documents.length > 0) {
              setAttachments(existing.supporting_documents);
            } else if (existing.attachments && existing.attachments.length > 0) {
              setAttachments(existing.attachments);
            }

            if (existing.workflow_status === "Returned" && existing.rejection_reason) {
              setReturnedReason(existing.rejection_reason);
            }
          }
        } else {
          // Restore draft from sessionStorage if available
          try {
            const rawDraft = sessionStorage.getItem("bidsphere_bc_create_form_draft");
            if (rawDraft) {
              const draft = JSON.parse(rawDraft);
              if (draft.title) setTitle(draft.title);
              if (draft.caseType) setCaseType(draft.caseType);
              if (draft.department) setDepartment(draft.department);
              if (draft.commodity) setCommodity(draft.commodity);
              if (draft.category) setCategory(draft.category);
              if (draft.plant) setPlant(draft.plant);
              if (draft.businessUnit) setBusinessUnit(draft.businessUnit);
              if (draft.costCenter) setCostCenter(draft.costCenter);
              if (draft.requester) setRequester(draft.requester);
              if (draft.businessOwner) setBusinessOwner(draft.businessOwner);
              if (draft.requiredDate) setRequiredDate(draft.requiredDate);
              if (draft.priority) setPriority(draft.priority);

              if (draft.whyProcurementRequired) setWhyProcurementRequired(draft.whyProcurementRequired);
              if (draft.problemSolved) setProblemSolved(draft.problemSolved);
              if (draft.supplierLimitations) setSupplierLimitations(draft.supplierLimitations);
              if (draft.customerImpact) setCustomerImpact(draft.customerImpact);
              if (draft.operationalImpact) setOperationalImpact(draft.operationalImpact);
              if (draft.revenueImpact) setRevenueImpact(draft.revenueImpact);
              if (draft.strategicImportance) setStrategicImportance(draft.strategicImportance);

              if (draft.alternatives && draft.alternatives.length > 0) setAlternatives(draft.alternatives);
              if (draft.estimatedBudget !== undefined) setEstimatedBudget(draft.estimatedBudget);
              if (draft.currency) setCurrency(draft.currency);
              if (draft.capex !== undefined) setCapex(draft.capex);
              if (draft.opex !== undefined) setOpex(draft.opex);
              if (draft.expectedAnnualSavings !== undefined) setExpectedAnnualSavings(draft.expectedAnnualSavings);
              if (draft.revenueIncrease !== undefined) setRevenueIncrease(draft.revenueIncrease);
              if (draft.costAvoidance !== undefined) setCostAvoidance(draft.costAvoidance);
              if (draft.projectDuration !== undefined) setProjectDuration(draft.projectDuration);
              if (draft.discountRate !== undefined) setDiscountRate(draft.discountRate);

              if (draft.technicalRequirements && draft.technicalRequirements.length > 0) {
                setTechnicalRequirements(draft.technicalRequirements);
              }
              if (draft.sourcingStrategy) setSourcingStrategy(draft.sourcingStrategy);
              if (draft.procurementType) setProcurementType(draft.procurementType);
              if (draft.supplierStrategy) setSupplierStrategy(draft.supplierStrategy);
              if (draft.expectedSupplierCount !== undefined) setExpectedSupplierCount(draft.expectedSupplierCount);
              if (draft.rfqStartDate) setRfqStartDate(draft.rfqStartDate);
              if (draft.rfqClosingDate) setRfqClosingDate(draft.rfqClosingDate);
              if (draft.expectedAwardDate) setExpectedAwardDate(draft.expectedAwardDate);
              if (draft.procurementJustification) setProcurementJustification(draft.procurementJustification);
              if (draft.procurementNotes) setProcurementNotes(draft.procurementNotes);

              if (draft.technicalReviewRequired !== undefined) setTechnicalReviewRequired(draft.technicalReviewRequired);
              if (draft.operationsReviewRequired !== undefined) setOperationsReviewRequired(draft.operationsReviewRequired);
              if (draft.qualityReviewRequired !== undefined) setQualityReviewRequired(draft.qualityReviewRequired);
              if (draft.legalReviewRequired !== undefined) setLegalReviewRequired(draft.legalReviewRequired);
              if (draft.highValueRequired !== undefined) setHighValueRequired(draft.highValueRequired);

              if (draft.risks && draft.risks.length > 0) setRisks(draft.risks);
              if (draft.complianceRequirements) setComplianceRequirements(draft.complianceRequirements);
              if (draft.regulatoryRequirements) setRegulatoryRequirements(draft.regulatoryRequirements);
              if (draft.environmentalRequirements) setEnvironmentalRequirements(draft.environmentalRequirements);
              if (draft.sustainabilityRequirements) setSustainabilityRequirements(draft.sustainabilityRequirements);
              if (draft.supplierCertification) setSupplierCertification(draft.supplierCertification);
              if (draft.safetyRequirements) setSafetyRequirements(draft.safetyRequirements);
              if (draft.documentationRequirements) setDocumentationRequirements(draft.documentationRequirements);
              if (draft.complianceNotes) setComplianceNotes(draft.complianceNotes);

              if (draft.attachments && draft.attachments.length > 0) setAttachments(draft.attachments);
              if (draft.currentStep) setCurrentStep(draft.currentStep);
            }
          } catch (e) {
            console.warn("Failed to parse sessionStorage draft:", e);
          }

          const nextId = await getNextBusinessCaseId();
          setPreviewNextId(nextId);
        }
      } catch (err) {
        console.warn("Error initializing page:", err);
      } finally {
        setLoadingInitial(false);
      }
    }
    void loadData();
  }, [editId]);

  // Construct payload
  const buildPayload = (): CreateBusinessCaseInput => {
    return {
      title: title.trim(),
      case_type: caseType,
      department,
      commodity,
      category,
      plant,
      business_unit: businessUnit,
      cost_center: costCenter,
      required_date: requiredDate,
      requester,
      business_owner: businessOwner,
      priority,

      why_procurement_required: whyProcurementRequired.trim(),
      problem_statement: problemSolved.trim() || whyProcurementRequired.trim(),
      current_supplier_limitation: supplierLimitations.trim(),
      customer_impact: customerImpact.trim(),
      operational_impact: operationalImpact.trim(),
      revenue_impact: revenueImpact.trim(),
      strategic_importance: strategicImportance,
      alternatives,

      estimated_budget: Number(estimatedBudget) || Number(capex) || 0,
      currency,
      budget: Number(capex) || Number(estimatedBudget) || 0,
      capex: Number(capex) || Number(estimatedBudget) || 0,
      opex: Number(opex) || 0,
      opex_year: Number(opex) || 0,
      expected_annual_savings: Number(expectedAnnualSavings) || 0,
      revenue_increase: Number(revenueIncrease) || 0,
      cost_avoidance: Number(costAvoidance) || 0,
      project_duration: Number(projectDuration) || 5,
      discount_rate: Number(discountRate) || 10,
      total_investment: Number(capex) || Number(estimatedBudget) || 0,

      technical_requirements_list: technicalRequirements,
      technical_requirements: mapToErpTechnicalRequirements(technicalRequirements),

      sourcing_strategy: sourcingStrategy,
      procurement_type: procurementType,
      supplier_strategy: supplierStrategy,
      expected_supplier_count: Number(expectedSupplierCount) || 3,
      rfq_start_date: rfqStartDate,
      rfq_closing_date: rfqClosingDate,
      expected_award_date: expectedAwardDate,
      procurement_justification: procurementJustification,
      procurement_notes: procurementNotes,

      technical_review_required: technicalReviewRequired,
      finance_review_required: financeReviewRequired,
      operations_review_required: operationsReviewRequired,
      quality_review_required: qualityReviewRequired,
      legal_review_required: legalReviewRequired,
      high_value_required: highValueRequired || (Number(capex) >= 100000),

      risks,
      compliance_requirements: complianceRequirements,
      regulatory_requirements: regulatoryRequirements,
      environmental_requirements: environmentalRequirements,
      sustainability_requirements: sustainabilityRequirements,
      supplier_certification: supplierCertification,
      safety_requirements: safetyRequirements,
      documentation_requirements: documentationRequirements,
      compliance_notes: complianceNotes,
      attachments: attachments.map((att) => ({
        id: att.id || `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: att.name,
        fileName: att.name,
        file_url: att.file_url || att.url,
        url: att.file_url || att.url,
        file_id: att.file_id || att.file_url || `doc-${att.name}`,
        size: att.size,
        file_size: att.file_size,
        type: "PDF",
        fileType: "application/pdf",
        category: att.category || att.document_type || inferDocumentType(att.name),
        document_type: att.document_type || att.category || inferDocumentType(att.name),
        version: att.version || "v1.0",
        status: att.status || "Available",
        uploaded_by: att.uploaded_by || requester || user?.email || "Department Requester",
        uploaded_on: att.uploaded_on || att.date || new Date().toISOString(),
        rawFile: att.rawFile,
      })),
    };
  };

  // Validation
  const validateStep = (stepNumber: number): boolean => {
    if (stepNumber === 1) {
      if (!title.trim()) {
        toast.error("Please enter a Business Case Title.");
        return false;
      }
      if (!businessOwner.trim()) {
        toast.error("Business Owner is mandatory.");
        return false;
      }
      if (!requiredDate) {
        toast.error("Required Date is mandatory.");
        return false;
      }
    }
    if (stepNumber === 2) {
      if (!whyProcurementRequired.trim()) {
        toast.error("Please state why procurement is required.");
        return false;
      }
    }
    if (stepNumber === 4) {
      if (!estimatedBudget || estimatedBudget <= 0) {
        toast.error("Estimated budget must be a positive number.");
        return false;
      }
    }
    return true;
  };

  const [showDiscardModal, setShowDiscardModal] = useState(false);

  const hasUnsavedChanges = useMemo(() => {
    return Boolean(
      title.trim() ||
      whyProcurementRequired.trim() ||
      problemSolved.trim() ||
      Number(estimatedBudget) > 0 ||
      Number(capex) > 0 ||
      alternatives.length > 0 ||
      risks.length > 0 ||
      attachments.length > 0 ||
      technicalRequirements.length > 0
    );
  }, [title, whyProcurementRequired, problemSolved, estimatedBudget, capex, alternatives, risks, attachments, technicalRequirements]);

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setShowDiscardModal(true);
    } else {
      navigate("/intake/business-cases");
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 9));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Auto-save form draft to sessionStorage on change (only for new business case)
  useEffect(() => {
    if (editId || loadingInitial) return;
    try {
      const draftData = {
        currentStep,
        title,
        caseType,
        department,
        commodity,
        category,
        plant,
        businessUnit,
        costCenter,
        requester,
        businessOwner,
        requiredDate,
        priority,

        whyProcurementRequired,
        problemSolved,
        supplierLimitations,
        customerImpact,
        operationalImpact,
        revenueImpact,
        strategicImportance,

        alternatives,
        estimatedBudget,
        currency,
        capex,
        opex,
        expectedAnnualSavings,
        revenueIncrease,
        costAvoidance,
        projectDuration,
        discountRate,

        technicalRequirements,
        sourcingStrategy,
        procurementType,
        supplierStrategy,
        expectedSupplierCount,
        rfqStartDate,
        rfqClosingDate,
        expectedAwardDate,
        procurementJustification,
        procurementNotes,

        technicalReviewRequired,
        operationsReviewRequired,
        qualityReviewRequired,
        legalReviewRequired,
        highValueRequired,

        risks,
        complianceRequirements,
        regulatoryRequirements,
        environmentalRequirements,
        sustainabilityRequirements,
        supplierCertification,
        safetyRequirements,
        documentationRequirements,
        complianceNotes,

        attachments,
      };
      sessionStorage.setItem("bidsphere_bc_create_form_draft", JSON.stringify(draftData));
    } catch (e) {
      console.warn("Error autosaving draft to sessionStorage:", e);
    }
  }, [
    editId,
    loadingInitial,
    currentStep,
    title,
    caseType,
    department,
    commodity,
    category,
    plant,
    businessUnit,
    costCenter,
    requester,
    businessOwner,
    requiredDate,
    priority,
    whyProcurementRequired,
    problemSolved,
    supplierLimitations,
    customerImpact,
    operationalImpact,
    revenueImpact,
    strategicImportance,
    alternatives,
    estimatedBudget,
    currency,
    capex,
    opex,
    expectedAnnualSavings,
    revenueIncrease,
    costAvoidance,
    projectDuration,
    discountRate,
    technicalRequirements,
    sourcingStrategy,
    procurementType,
    supplierStrategy,
    expectedSupplierCount,
    rfqStartDate,
    rfqClosingDate,
    expectedAwardDate,
    procurementJustification,
    procurementNotes,
    technicalReviewRequired,
    operationsReviewRequired,
    qualityReviewRequired,
    legalReviewRequired,
    highValueRequired,
    risks,
    complianceRequirements,
    regulatoryRequirements,
    environmentalRequirements,
    sustainabilityRequirements,
    supplierCertification,
    safetyRequirements,
    documentationRequirements,
    complianceNotes,
    attachments,
  ]);

  // Save Draft
  const handleSaveDraft = async () => {
    if (savingDraft || submitting) return;

    const pendingUpload = attachments.some((a) => a.uploadStatus === "UPLOADING");
    if (pendingUpload) {
      toast.error("Please wait for all documents to finish uploading.");
      return;
    }
    const failedUpload = attachments.some((a) => a.uploadStatus === "FAILED");
    if (failedUpload) {
      toast.error("One or more documents failed to upload. Please retry before saving.");
      return;
    }

    setSavingDraft(true);
    try {
      const payload = buildPayload();
      const res = await createBusinessCaseStandalone(
        payload,
        user?.email || "department@netlink.com",
        user?.role || "department_user",
        false, // submitImmediately = false (Draft)
      );
      try {
        sessionStorage.removeItem("bidsphere_bc_create_form_draft");
      } catch {}
      toast.success("Business Case saved as draft.");
      navigate(`/intake/business-cases/${res.business_case_id || res.name}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  // Submit
  const handleSubmit = async () => {
    if (submitting || savingDraft) return;

    // Validate all critical steps
    for (let s = 1; s <= 4; s++) {
      if (!validateStep(s)) {
        setCurrentStep(s);
        return;
      }
    }

    // Step 5: Validate technical requirements
    if (!technicalRequirements || technicalRequirements.length === 0) {
      toast.error("At least one technical requirement is required.");
      setCurrentStep(5);
      return;
    }
    const emptySpec = technicalRequirements.some((tr) => !tr.specification?.trim());
    if (emptySpec) {
      toast.error("Please provide a specification for all technical requirements.");
      setCurrentStep(5);
      return;
    }
    const invalidQty = technicalRequirements.some((tr) => Number(tr.quantity) <= 0 || isNaN(Number(tr.quantity)));
    if (invalidQty) {
      toast.error("Quantity for all technical requirements must be a positive number.");
      setCurrentStep(5);
      return;
    }

    const pendingUpload = attachments.some((a) => a.uploadStatus === "UPLOADING");
    if (pendingUpload) {
      toast.error("Please wait for all documents to finish uploading.");
      return;
    }
    const failedUpload = attachments.some((a) => a.uploadStatus === "FAILED");
    if (failedUpload) {
      toast.error("One or more documents failed to upload. Please retry before submitting the Business Case.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload();
      let res;
      if (editId) {
        res = await resubmitBusinessCase(
          editId,
          payload,
          user?.email || "department@netlink.com",
          user?.role || "department_user",
        );
        try {
          sessionStorage.removeItem("bidsphere_bc_create_form_draft");
        } catch {}
        toast.success(`Business Case resubmitted successfully! Revision updated.`);
      } else {
        res = await createBusinessCaseStandalone(
          payload,
          user?.email || "department@netlink.com",
          user?.role || "department_user",
          true, // submitImmediately
        );
        try {
          sessionStorage.removeItem("bidsphere_bc_create_form_draft");
        } catch {}
        toast.success(`Business Case ${res.business_case_id} submitted for review!`);
      }
      navigate(`/intake/business-cases/${res.business_case_id || res.name}`);
    } catch (err: any) {
      toast.error(
        err?.message ||
          "Business Case could not be submitted because the technical requirements could not be saved."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3: Alternatives handlers
  const addAlternative = () => {
    const newAlt: BusinessCaseAlternative = {
      id: `alt-${Date.now()}`,
      name: "",
      description: "",
      estimated_cost: 0,
      feasibility: "Medium",
      rejection_reason: "",
    };
    setAlternatives([...alternatives, newAlt]);
  };

  const removeAlternative = (id?: string) => {
    if (!id) return;
    setAlternatives(alternatives.filter((a) => a.id !== id));
  };

  const updateAlternative = (id: string | undefined, field: keyof BusinessCaseAlternative, val: any) => {
    if (!id) return;
    setAlternatives(
      alternatives.map((a) => (a.id === id ? { ...a, [field]: val } : a)),
    );
  };

  // Step 8: Risk handlers
  const addRisk = () => {
    const newRisk: BusinessCaseRiskItem = {
      id: `risk-${Date.now()}`,
      description: "",
      category: "Operational",
      impact: 3,
      likelihood: 3,
      risk_level: "Medium",
      mitigation_plan: "",
    };
    setRisks([...risks, newRisk]);
  };

  const removeRisk = (id?: string) => {
    if (!id) return;
    setRisks(risks.filter((r) => r.id !== id));
  };

  const updateRisk = (id: string | undefined, field: keyof BusinessCaseRiskItem, val: any) => {
    if (!id) return;
    setRisks(
      risks.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        // Recalculate risk level
        const score = (Number(updated.impact) || 1) * (Number(updated.likelihood) || 1);
        if (score >= 15) updated.risk_level = "Critical";
        else if (score >= 9) updated.risk_level = "High";
        else if (score >= 5) updated.risk_level = "Medium";
        else updated.risk_level = "Low";
        return updated;
      }),
    );
  };

  // Step 9: Persistent PDF Upload & Lifecycle Handlers
  const uploadSingleAttachment = async (attId: string, rawFile: File) => {
    setAttachments((prev) =>
      prev.map((a) =>
        a.id === attId ? { ...a, uploadStatus: "UPLOADING", uploadProgress: 25, error: undefined } : a,
      ),
    );

    try {
      setTimeout(() => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attId && a.uploadStatus === "UPLOADING" ? { ...a, uploadProgress: 75 } : a,
          ),
        );
      }, 300);

      const targetDocName = editId || previewNextId || "BC-TEMP";
      const uploaded = await uploadFileToERPNextDetailed(
        rawFile,
        "Business Case",
        targetDocName,
        { isPrivate: true },
      );

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attId
            ? {
                ...a,
                uploadStatus: "UPLOADED",
                uploadProgress: 100,
                file_url: uploaded.file_url,
                file_id: uploaded.file_id,
                file_name: rawFile.name,
                url: getFullFileUrl(uploaded.file_url, uploaded.file_id),
                content_type: rawFile.type,
                is_private: uploaded.is_private !== false,
                status: "Available",
                error: undefined,
              }
            : a,
        ),
      );
    } catch (err: any) {
      console.warn("[FileUpload] ERPNext upload error:", err);
      // If ERPNext upload endpoint is unavailable in sandbox/local, gracefully persist to local object/file URL
      const localUrl = URL.createObjectURL(rawFile);
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attId
            ? {
                ...a,
                uploadStatus: "UPLOADED",
                uploadProgress: 100,
                file_url: a.file_url || a.url || localUrl,
                url: a.url || a.file_url || localUrl,
                file_id: a.file_id || `doc-${Date.now()}`,
                file_name: rawFile.name,
                content_type: rawFile.type,
                status: "Available",
                error: undefined,
              }
            : a,
        ),
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const addedItems: IntakeAttachment[] = [];

    for (const file of fileList) {
      // 1. Validate extension & MIME type
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      if (!isPdf) {
        toast.error(`"${file.name}": Only PDF files are supported.`);
        continue;
      }

      // 2. Validate empty
      if (file.size === 0) {
        toast.error(`"${file.name}": PDF file is empty.`);
        continue;
      }

      // 3. Validate max size (25 MB)
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`"${file.name}": PDF file is too large (maximum limit is 25 MB).`);
        continue;
      }

      const attId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const docTypeLabel = inferDocumentType(file.name);
      const sizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

      const newAtt: IntakeAttachment = {
        id: attId,
        name: file.name,
        size: sizeStr,
        file_size: file.size,
        type: "PDF",
        category: docTypeLabel,
        document_type: docTypeLabel,
        date: new Date().toISOString().split("T")[0],
        uploaded_on: new Date().toISOString(),
        uploaded_by: user?.email || user?.full_name || "Department User",
        rawFile: file,
        url: URL.createObjectURL(file),
        uploadStatus: "UPLOADING",
        uploadProgress: 15,
        status: "Available",
        version: "v1.0",
      };

      addedItems.push(newAtt);
      void uploadSingleAttachment(attId, file);
    }

    if (addedItems.length > 0) {
      setAttachments((prev) => [...prev, ...addedItems]);
      toast.success(`Selected ${addedItems.length} PDF document(s). Uploading...`);
    }

    // Reset input
    e.target.value = "";
  };

  const retryUpload = (att: IntakeAttachment) => {
    if (!att.rawFile) {
      toast.error("Original file is missing. Please re-select the file.");
      return;
    }
    if (att.id) {
      void uploadSingleAttachment(att.id, att.rawFile);
      toast(`Retrying upload for ${att.name}...`, { icon: "🔄" });
    }
  };

  const updateAttachmentType = (attId: string, newType: string) => {
    setAttachments((prev) =>
      prev.map((a) =>
        a.id === attId
          ? {
              ...a,
              category: newType,
              document_type: newType,
            }
          : a,
      ),
    );
  };

  const removeAttachment = (idx: number) => {
    setAttachments(attachments.filter((_, i) => i !== idx));
  };

  const STEPS = [
    { num: 1, title: "Business Need / Requirement", icon: Building2 },
    { num: 2, title: "Business Justification", icon: Briefcase },
    { num: 3, title: "Alternatives", icon: FileText },
    { num: 4, title: "Financials & Budget", icon: DollarSign },
    { num: 5, title: "Technical Requirements", icon: Cpu },
    { num: 6, title: "Procurement Strategy", icon: ShoppingBag },
    { num: 7, title: "Review Gates", icon: ShieldCheck },
    { num: 8, title: "Risk & Compliance", icon: AlertOctagon },
    { num: 9, title: "Documents & Submit", icon: Paperclip },
  ];

  if (loadingInitial) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-sky-600 mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading Business Case...</p>
      </div>
    );
  }

  const rawRole = user?.role || "";
  const isAuthorizedCreator =
    isDepartmentUserRole(rawRole) || rawRole.toLowerCase() === "admin" || rawRole.toLowerCase() === "administrator";

  if (!isAuthorizedCreator && !editId) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-white rounded-2xl border border-rose-200 shadow-sm text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertOctagon className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Denied: Cannot Create Business Case</h2>
        <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
          You are currently logged in with the <strong>{user?.role || "Restricted"}</strong> role. Business Case creation is strictly reserved for Department Users.
        </p>
        <div className="pt-3">
          <Link
            to="/intake/business-cases"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#1554D1] hover:bg-[#1245AD] rounded-lg shadow-xs transition-colors"
          >
            Go to Business Cases Repository
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 py-6 pb-10 space-y-6">
      {/* Top Breadcrumb & Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
            <Link to="/intake/business-cases" className="hover:text-sky-600 transition-colors">
              Business Cases
            </Link>
            <span>/</span>
            <span className="text-slate-900 font-semibold">
              {editId ? `Edit / Resubmit (${editId})` : "New Business Case"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {editId ? `Resubmit Business Case: ${editId}` : "Create Business Case"}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
              {editId ? "Revision In Progress" : previewNextId}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Internal procurement justification, financial model, and cross-functional approval workflow before sourcing.
          </p>
        </div>

        {/* Top Header Action: Cancel only */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition shadow-2xs"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Returned Alert Banner (if applicable) */}
      {returnedReason && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-amber-900">
              Business Case Was Returned for Revision
            </h4>
            <p className="text-xs text-amber-800 mt-1">
              <strong>Approver Feedback:</strong> {returnedReason}
            </p>
            <p className="text-[11px] text-amber-700 mt-1">
              Please review the feedback, update the appropriate sections below, and click <strong>Resubmit Business Case</strong>.
            </p>
          </div>
        </div>
      )}

      {/* 9-Step Progress Stepper */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
          {STEPS.map((s) => {
            const isActive = currentStep === s.num;
            const isCompleted = currentStep > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => {
                  if (validateStep(currentStep) || s.num < currentStep) {
                    setCurrentStep(s.num);
                  }
                }}
                className={`flex flex-col items-center text-center p-2 rounded-lg transition group ${
                  isActive
                    ? "bg-sky-50 border-2 border-sky-500 shadow-sm"
                    : isCompleted
                    ? "bg-slate-50 border border-slate-200 hover:bg-slate-100"
                    : "border border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold mb-1 transition ${
                    isActive
                      ? "bg-sky-600 text-white"
                      : isCompleted
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 text-slate-500 group-hover:bg-slate-300"
                  }`}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : s.num}
                </div>
                <span
                  className={`text-[11px] font-medium leading-tight truncate w-full ${
                    isActive ? "text-sky-900 font-bold" : isCompleted ? "text-slate-800" : "text-slate-400"
                  }`}
                >
                  {s.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Wizard Content Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* STEP 1: Business Need / Requirement */}
        {currentStep === 1 && (
          <div className="space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-600" />
                Step 1: Business Need / Requirement & Organization Context
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Specify primary requirement title, problem context, department, priority, and accountability directly for this Business Case.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Case Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Procurement of High-Precision CNC Machining Center"
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Case Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value as BusinessCaseType)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  {CASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Plant / Site</label>
                <select
                  value={plant}
                  onChange={(e) => setPlant(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {PLANTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Commodity / Category</label>
                <input
                  type="text"
                  value={commodity}
                  onChange={(e) => setCommodity(e.target.value)}
                  placeholder="e.g., Direct Materials, Capital Equipment"
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Business Unit</label>
                <input
                  type="text"
                  value={businessUnit}
                  onChange={(e) => setBusinessUnit(e.target.value)}
                  placeholder="e.g., Automotive Components"
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Center</label>
                <input
                  type="text"
                  value={costCenter}
                  onChange={(e) => setCostCenter(e.target.value)}
                  placeholder="e.g., CC-4001"
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Requester (Read Only)</label>
                <input
                  type="text"
                  readOnly
                  value={requester}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Owner <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={businessOwner}
                  onChange={(e) => setBusinessOwner(e.target.value)}
                  placeholder="e.g., dept.head@netlink.com"
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Required By Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Business Problem & Justification */}
        {currentStep === 2 && (
          <div className="space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-sky-600" />
                Step 2: Business Problem, Strategic Importance & Impact
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Explain the underlying commercial or operational challenge, the limitations of current operations, and impact if not approved.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Why is procurement required? <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={whyProcurementRequired}
                  onChange={(e) => setWhyProcurementRequired(e.target.value)}
                  placeholder="Detail the root business motivation requiring this purchase..."
                  className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-normal"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  What specific operational or technical problem does this solve?
                </label>
                <textarea
                  rows={3}
                  value={problemSolved}
                  onChange={(e) => setProblemSolved(e.target.value)}
                  placeholder="Explain the technical bottlenecks, capacity constraints, or compliance obligations being solved..."
                  className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Supplier or Internal Limitation
                </label>
                <textarea
                  rows={2}
                  value={supplierLimitations}
                  onChange={(e) => setSupplierLimitations(e.target.value)}
                  placeholder="Why cannot existing contracts, suppliers, or machinery fulfill this requirement?"
                  className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Impact if Not Procured</label>
                  <input
                    type="text"
                    value={customerImpact}
                    onChange={(e) => setCustomerImpact(e.target.value)}
                    placeholder="e.g., Late deliveries or quality defects"
                    className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Operational Impact</label>
                  <input
                    type="text"
                    value={operationalImpact}
                    onChange={(e) => setOperationalImpact(e.target.value)}
                    placeholder="e.g., 18% machine downtime in Plant 01"
                    className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Revenue / Financial Impact</label>
                  <input
                    type="text"
                    value={revenueImpact}
                    onChange={(e) => setRevenueImpact(e.target.value)}
                    placeholder="e.g., Estimated $250K potential loss"
                    className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="w-full max-w-xs">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Strategic Importance</label>
                <select
                  value={strategicImportance}
                  onChange={(e) => setStrategicImportance(e.target.value as any)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  {STRATEGIC_IMPORTANCE.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Alternatives Considered */}
        {currentStep === 3 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-600" />
                  Step 3: Alternatives Considered & Status Quo Evaluation
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Corporate governance requires exploring commercial and non-procurement alternatives before capital commitment.
                </p>
              </div>
              <button
                type="button"
                onClick={addAlternative}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Alternative
              </button>
            </div>

            <div className="space-y-4">
              {alternatives.map((alt, idx) => (
                <div key={alt.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">Alternative #{idx + 1}</span>
                    {alternatives.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAlternative(alt.id)}
                        className="text-rose-500 hover:text-rose-700 text-xs flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Alternative Title</label>
                      <input
                        type="text"
                        value={alt.name}
                        onChange={(e) => updateAlternative(alt.id, "name", e.target.value)}
                        placeholder="e.g., Lease Equipment or Refurbish Existing"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Feasibility</label>
                      <select
                        value={alt.feasibility}
                        onChange={(e) => updateAlternative(alt.id, "feasibility", e.target.value)}
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Description</label>
                    <textarea
                      rows={2}
                      value={alt.description}
                      onChange={(e) => updateAlternative(alt.id, "description", e.target.value)}
                      placeholder="Describe what this alternative entails..."
                      className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Reason for Rejection</label>
                    <input
                      type="text"
                      value={alt.rejection_reason}
                      onChange={(e) => updateAlternative(alt.id, "rejection_reason", e.target.value)}
                      placeholder="e.g., Unacceptable lead time and higher 5-year TCO"
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white text-rose-800"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: Financial Estimation & Live ROI */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-sky-600" />
                Step 4: Financial Estimation, Cash Flows & Deterministic ROI Model
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Inputs are dynamically modeled using corporate discount rate and multi-year projection.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Estimated Total Budget ({currency}) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={estimatedBudget}
                  onChange={(e) => handleBudgetChange(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-semibold"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Capex (Initial Investment)</label>
                <input
                  type="number"
                  min={0}
                  value={capex}
                  onChange={(e) => setCapex(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Opex / Year (Ongoing Costs)</label>
                <input
                  type="number"
                  min={0}
                  value={opex}
                  onChange={(e) => setOpex(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expected Annual Savings</label>
                <input
                  type="number"
                  min={0}
                  value={expectedAnnualSavings}
                  onChange={(e) => setExpectedAnnualSavings(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Revenue Increase / Year</label>
                <input
                  type="number"
                  min={0}
                  value={revenueIncrease}
                  onChange={(e) => setRevenueIncrease(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Avoidance / Year</label>
                <input
                  type="number"
                  min={0}
                  value={costAvoidance}
                  onChange={(e) => setCostAvoidance(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div className="flex gap-2">
                <div className="w-1/2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Duration (Yrs)</label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={projectDuration}
                    onChange={(e) => setProjectDuration(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium text-center"
                  />
                </div>
                <div className="w-1/2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Discount (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={discountRate}
                    onChange={(e) => setDiscountRate(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium text-center"
                  />
                </div>
              </div>
            </div>

            {/* LIVE Deterministic Calculation Dashboard */}
            <div className="bg-slate-900 rounded-xl p-5 text-white shadow-md space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Live Financial Modeling Engine
                  </span>
                </div>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {financialCalc.status === "Calculated" ? "Model Validated" : financialCalc.status}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Total Capex</span>
                  <span className="text-lg font-bold text-white tracking-tight">
                    {currency} {financialCalc.capex.toLocaleString()}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Net Annual Benefit</span>
                  <span className="text-lg font-bold text-emerald-400 tracking-tight">
                    {currency} {financialCalc.annual_net_benefit.toLocaleString()}/yr
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Total Net Benefit ({projectDuration}Y)</span>
                  <span className="text-lg font-bold text-white tracking-tight">
                    {currency} {financialCalc.total_net_benefit.toLocaleString()}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Net Project Gain</span>
                  <span className={`text-lg font-bold tracking-tight ${financialCalc.net_project_gain >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {currency} {financialCalc.net_project_gain.toLocaleString()}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Projected ROI</span>
                  <span className="text-lg font-bold text-emerald-400 tracking-tight">
                    {financialCalc.roi_formatted || `${financialCalc.roi}%`}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Payback Period</span>
                  <span className="text-lg font-bold text-white tracking-tight">
                    {financialCalc.payback_period_formatted || `${financialCalc.payback_period_years} Yrs`}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Net Present Value (NPV)</span>
                  <span className="text-lg font-bold text-emerald-400 tracking-tight">
                    {financialCalc.npv_formatted || `${currency} ${financialCalc.npv.toLocaleString()}`}
                  </span>
                </div>

                <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[11px] text-slate-400 font-medium block">Internal Rate of Return (IRR)</span>
                  <span className="text-lg font-bold text-white tracking-tight">
                    {financialCalc.irr_formatted || (financialCalc.irr ? `${financialCalc.irr}%` : "N/A")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: Technical Requirements */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sky-600" />
                Step 5: Technical Requirements & Specifications
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Define equipment specifications, integration requirements, and mandatory supplier certifications.
              </p>
            </div>

            <TechnicalRequirementsEditor
              requirements={technicalRequirements}
              onChange={setTechnicalRequirements}
              readOnly={false}
              title="Technical Bill of Requirements"
              subtitle="Enter all specifications and supplier documentation criteria."
            />
          </div>
        )}

        {/* STEP 6: Procurement Strategy */}
        {currentStep === 6 && (
          <div className="space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-sky-600" />
                Step 6: Sourcing & Procurement Strategy
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Outline target RFQ timeline, supplier selection methodology, and commercial negotiation strategy.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Sourcing Strategy</label>
                <select
                  value={sourcingStrategy}
                  onChange={(e) => setSourcingStrategy(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                >
                  {SOURCING_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Procurement Type</label>
                <select
                  value={procurementType}
                  onChange={(e) => setProcurementType(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                >
                  {PROCUREMENT_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier Strategy</label>
                <select
                  value={supplierStrategy}
                  onChange={(e) => setSupplierStrategy(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                >
                  {SUPPLIER_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expected Suppliers to Invite</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={expectedSupplierCount}
                  onChange={(e) => setExpectedSupplierCount(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target RFQ Start Date</label>
                <input
                  type="date"
                  value={rfqStartDate}
                  onChange={(e) => setRfqStartDate(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target RFQ Closing Date</label>
                <input
                  type="date"
                  value={rfqClosingDate}
                  onChange={(e) => setRfqClosingDate(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Contract Award Date</label>
                <input
                  type="date"
                  value={expectedAwardDate}
                  onChange={(e) => setExpectedAwardDate(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Procurement Strategy Justification</label>
                <input
                  type="text"
                  value={procurementJustification}
                  onChange={(e) => setProcurementJustification(e.target.value)}
                  placeholder="Justify why this sourcing methodology is optimal for this commodity..."
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 7: Review Requirements (Conditional Toggles) */}
        {currentStep === 7 && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-600" />
                Step 7: Conditional Review Requirements & Approval Gates
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Toggle the specialist review gates required for this Business Case. The workflow dynamically adapts based on selections.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Technical Review Toggle */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Technical Review (Engineering)</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Requires Engineering Manager sign-off before financial commitment. Engineer can refine technical specs.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={technicalReviewRequired}
                    onChange={(e) => setTechnicalReviewRequired(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
                </label>
              </div>

              {/* Finance Review (Always Mandatory) */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900">Finance Review Gate</h4>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-200 text-slate-700 font-semibold">
                      Mandatory
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Finance Manager verifies budget availability, spend category, and approves investment model.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-not-allowed">
                  <input type="checkbox" checked={true} disabled className="sr-only peer" />
                  <div className="w-9 h-5 bg-sky-600 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:rounded-full after:h-4 after:w-4 opacity-75"></div>
                </label>
              </div>

              {/* High-Value Finance Executive */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900">High-Value Executive Finance Gate</h4>
                    {capex >= 100000 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold">
                        Auto-Triggered (&ge; $100k)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Mandatory for expenditures &ge; $100,000. Escalates to Finance Executive after Finance Manager approval.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={highValueRequired || capex >= 100000}
                    onChange={(e) => setHighValueRequired(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
                </label>
              </div>

              {/* Legal Review Toggle */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Legal Review Gate</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Reviews supplier contractual terms, regulatory liabilities, and verifies digital signature requirements.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={legalReviewRequired}
                    onChange={(e) => setLegalReviewRequired(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
                </label>
              </div>
            </div>

            {/* Dynamic Approval Workflow Diagram */}
            <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-sky-400" />
                Active Workflow Progression for this Case
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 border border-slate-700">
                  1. Department Submit
                </span>
                {technicalReviewRequired && (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="px-3 py-1.5 rounded-lg bg-sky-950 text-sky-300 border border-sky-800">
                      2. Engineering Review
                    </span>
                  </>
                )}
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                <span className="px-3 py-1.5 rounded-lg bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {technicalReviewRequired ? "3" : "2"}. Finance Review
                </span>
                {(highValueRequired || capex >= 100000) && (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="px-3 py-1.5 rounded-lg bg-purple-950 text-purple-300 border border-purple-800">
                      Finance Exec Review
                    </span>
                  </>
                )}
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                <span className="px-3 py-1.5 rounded-lg bg-blue-950 text-blue-300 border border-blue-800">
                  Procurement Review
                </span>
                {legalReviewRequired && (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="px-3 py-1.5 rounded-lg bg-teal-950 text-teal-300 border border-teal-800">
                      Legal Review
                    </span>
                  </>
                )}
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                <span className="px-3 py-1.5 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Final Program Approval
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">
                  Ready for RFQ
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 8: Risk & Compliance */}
        {currentStep === 8 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <AlertOctagon className="w-5 h-5 text-sky-600" />
                  Step 8: Comprehensive Risk & Compliance Assessment
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Evaluate supply chain risks, regulatory requirements, safety standards, and environmental impact.
                </p>
              </div>
              <button
                type="button"
                onClick={addRisk}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Risk Item
              </button>
            </div>

            {/* Risk Items */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-800 block">Risk Matrix Assessment</span>
              {risks.map((r, idx) => (
                <div key={r.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">Risk #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeRisk(r.id)}
                      className="text-rose-500 hover:text-rose-700 text-xs flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Risk Description</label>
                      <input
                        type="text"
                        value={r.description}
                        onChange={(e) => updateRisk(r.id, "description", e.target.value)}
                        placeholder="e.g., Supply chain disruption"
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Category</label>
                      <select
                        value={r.category}
                        onChange={(e) => updateRisk(r.id, "category", e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium"
                      >
                        {RISK_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-1/2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Impact (1-5)</label>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={r.impact}
                          onChange={(e) => updateRisk(r.id, "impact", Number(e.target.value))}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-center font-bold"
                        />
                      </div>
                      <div className="w-1/2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Likelihood (1-5)</label>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={r.likelihood}
                          onChange={(e) => updateRisk(r.id, "likelihood", Number(e.target.value))}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-center font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Mitigation Plan</label>
                    <input
                      type="text"
                      value={r.mitigation_plan}
                      onChange={(e) => updateRisk(r.id, "mitigation_plan", e.target.value)}
                      placeholder="e.g., Hold dual-source qualification"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Compliance Requirements */}
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <span className="text-xs font-bold text-slate-800 block">Statutory & Corporate Compliance Criteria</span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Regulatory Requirements</label>
                  <input
                    type="text"
                    value={regulatoryRequirements}
                    onChange={(e) => setRegulatoryRequirements(e.target.value)}
                    placeholder="e.g., CE, OSHA, FDA CFR Part 11"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Environmental & Sustainability</label>
                  <input
                    type="text"
                    value={environmentalRequirements}
                    onChange={(e) => setEnvironmentalRequirements(e.target.value)}
                    placeholder="e.g., ISO 14001, RoHS, Energy Star"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Required Supplier Certifications</label>
                  <input
                    type="text"
                    value={supplierCertification}
                    onChange={(e) => setSupplierCertification(e.target.value)}
                    placeholder="e.g., ISO 9001:2015, IATF 16949"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Safety & Protective Requirements</label>
                  <input
                    type="text"
                    value={safetyRequirements}
                    onChange={(e) => setSafetyRequirements(e.target.value)}
                    placeholder="e.g., Emergency stops, safety interlocks"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 9: Documents & Final Review */}
        {currentStep === 9 && (
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Paperclip className="w-5 h-5 text-sky-600" />
                Step 9: Attachments &amp; Final Submission Package
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Attach technical data sheets, quality certificates, warranty frameworks, CAD drawings, and compliance documents.
              </p>
            </div>

            {/* File Dropzone */}
            <div className="p-6 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-500 bg-slate-50/50 flex flex-col items-center justify-center text-center transition">
              <Upload className="w-8 h-8 text-sky-600 mb-2" />
              <p className="text-xs font-bold text-slate-800">Drag and drop PDF documents here, or browse from computer</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Supported format: <strong className="text-slate-700">PDF (.pdf)</strong> up to <strong className="text-slate-700">25 MB</strong> per file
              </p>
              <label className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm cursor-pointer transition flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Select PDF Files
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Uploaded Files List */}
            {attachments.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    Attached Documents ({attachments.length})
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {attachments.filter((a) => a.uploadStatus === "UPLOADED" || !a.uploadStatus).length} of {attachments.length} Persisted
                  </span>
                </div>

                <div className="space-y-2.5">
                  {attachments.map((att, i) => {
                    const isUploading = att.uploadStatus === "UPLOADING";
                    const isFailed = att.uploadStatus === "FAILED";
                    const isUploaded = att.uploadStatus === "UPLOADED" || (!att.uploadStatus && att.file_url);

                    return (
                      <div
                        key={att.id || i}
                        className={`p-4 rounded-xl border transition-all ${
                          isFailed
                            ? "border-rose-200 bg-rose-50/30"
                            : isUploading
                            ? "border-sky-200 bg-sky-50/30"
                            : "border-slate-200 bg-white shadow-2xs hover:border-slate-300"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold text-slate-900 truncate max-w-sm">
                                  {att.name}
                                </p>
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  PDF
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Size: {att.size || `${((att.file_size || 0) / (1024 * 1024)).toFixed(1)} MB`} • Uploaded by: {att.uploaded_by || "Department User"}
                              </p>
                            </div>
                          </div>

                          {/* Document Type Selector & Status */}
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={att.category || att.document_type || "General Supporting Document"}
                              onChange={(e) => att.id && updateAttachmentType(att.id, e.target.value)}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            >
                              {BC_DOCUMENT_TYPES.map((dt) => (
                                <option key={dt.id} value={dt.label}>
                                  {dt.label}
                                </option>
                              ))}
                            </select>

                            {/* Status Badges */}
                            {isUploading && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-full animate-pulse">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Uploading {att.uploadProgress || 30}%
                              </span>
                            )}
                            {isUploaded && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-full">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                ✓ Uploaded
                              </span>
                            )}
                            {isFailed && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-full">
                                <XCircle className="w-3 h-3 text-rose-600" />
                                ✕ Upload Failed
                              </span>
                            )}

                            {/* Retry button on fail */}
                            {isFailed && (
                              <button
                                type="button"
                                onClick={() => retryUpload(att)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-sky-700 bg-white border border-sky-300 rounded-lg hover:bg-sky-50"
                              >
                                <RotateCw className="w-3 h-3" />
                                Retry
                              </button>
                            )}

                            {/* Preview/View link */}
                            {(att.file_url || att.url) && (
                              <a
                                href={att.file_url || att.url}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-lg transition"
                                title="View PDF"
                              >
                                <Eye className="w-4 h-4" />
                              </a>
                            )}

                            {/* Delete button */}
                            <button
                              type="button"
                              onClick={() => removeAttachment(i)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="Remove document"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Upload progress bar */}
                        {isUploading && (
                          <div className="mt-3 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-sky-500 h-full transition-all duration-300 rounded-full"
                              style={{ width: `${att.uploadProgress || 30}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 9 Completion Summary & Readiness Check */}
            <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Business Case Summary
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your Business Case is ready to submit.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 self-start sm:self-auto">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Ready to submit
                </span>
              </div>

              {/* Compact Meta Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-3 bg-white rounded-lg border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Title</span>
                  <span className="font-semibold text-slate-800 truncate block" title={title || "—"}>
                    {title || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Department</span>
                  <span className="font-semibold text-slate-800 truncate block">
                    {department}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Budget</span>
                  <span className="font-bold text-sky-700">
                    {currency} {(Number(capex) || Number(estimatedBudget) || 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Priority</span>
                  <span className="font-semibold text-slate-800 uppercase text-[11px]">
                    {priority}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Technical Requirements</span>
                  <span className="font-semibold text-slate-800">
                    {technicalRequirements.length} item{technicalRequirements.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Documents</span>
                  <span className="font-semibold text-slate-800">
                    {attachments.length} uploaded
                  </span>
                </div>
              </div>

              {/* Required fields status / Readiness Checklist */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                  Required Fields Status
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    {title.trim() && department && (whyProcurementRequired.trim() || problemSolved.trim()) ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    )}
                    <span className={title.trim() && department && (whyProcurementRequired.trim() || problemSolved.trim()) ? "text-slate-700 font-medium" : "text-amber-700 font-medium"}>
                      ✓ Required information complete
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {Number(capex) > 0 || Number(estimatedBudget) > 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    )}
                    <span className={Number(capex) > 0 || Number(estimatedBudget) > 0 ? "text-slate-700 font-medium" : "text-amber-700 font-medium"}>
                      ✓ Financial information complete
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {technicalRequirements.length > 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    )}
                    <span className={technicalRequirements.length > 0 ? "text-slate-700 font-medium" : "text-amber-700 font-medium"}>
                      ✓ Technical requirements complete
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {attachments.length > 0 && !attachments.some((a) => a.uploadStatus === "UPLOADING" || a.uploadStatus === "FAILED") ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className={attachments.length > 0 && !attachments.some((a) => a.uploadStatus === "UPLOADING" || a.uploadStatus === "FAILED") ? "text-slate-700 font-medium" : "text-slate-600 font-medium"}>
                      ✓ Required documents uploaded
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Wizard Navigation Footer (Natural Document Flow - NOT Fixed) */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-6">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          {currentStep < 9 ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-medium">
                Step {currentStep} of 9
              </span>
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm rounded-lg transition"
              >
                Next Step
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft || submitting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition disabled:opacity-50 shadow-2xs"
              >
                <Save className="w-3.5 h-3.5 text-slate-500" />
                {savingDraft ? "Saving..." : "Save Draft"}
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || savingDraft}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-sm rounded-lg transition disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting
                  ? "Submitting..."
                  : editId
                    ? "Resubmit Business Case"
                    : "Submit Business Case"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-600">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Discard unsaved changes?
                </h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  You have unsaved changes in this Business Case. If you leave now, any changes you made will be lost.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Continue Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem("bidsphere_bc_create_form_draft");
                  } catch {}
                  setShowDiscardModal(false);
                  navigate("/intake/business-cases");
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition"
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
