import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  ArrowUpRight,
  RefreshCw,
  Plus,
  X,
  FileCheck,
  Eye,
  Edit3,
  Sparkles,
  Layers,
  ShieldCheck,
  DollarSign,
  Scale,
  Briefcase,
  Wrench,
} from "lucide-react";

import {
  fetchRoleBusinessCases,
  isDepartmentUserRole,
  isLegalManagerRole,
  isFinanceManagerRole,
  isEngineerRole,
  isEngineeringManagerRole,
  isProcurementManagerRole,
} from "../../api/businessIntake";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuthStore } from "../../store/authStore";
import type { BusinessCase } from "../../types/businessIntake";

export default function BusinessCasesListPage() {
  const user = useAuthStore((s) => s.user);
  const rawRole = user?.role || "";
  const userEmail = user?.email || "";

  const isLegal = isLegalManagerRole(rawRole) || userEmail.toLowerCase().includes("legal");
  const isFinance = isFinanceManagerRole(rawRole) || userEmail.toLowerCase().includes("finance");
  const isProcurement = isProcurementManagerRole(rawRole) || userEmail.toLowerCase().includes("procurement");
  const isEngineer = isEngineerRole(rawRole);
  const isEngMgr = isEngineeringManagerRole(rawRole);
  const isDept = isDepartmentUserRole(rawRole);
  const isAdmin = rawRole.toLowerCase() === "admin" || rawRole.toLowerCase() === "administrator";

  const canCreateBusinessCase = isDept || isAdmin;

  const [searchParams, setSearchParams] = useSearchParams();

  // Role-specific screen definitions
  const roleScreenConfig = useMemo(() => {
    if (isDept) {
      return {
        title: "MY BUSINESS CASES",
        subtitle: "Authoritative justification records, dynamic financial models, and department requests.",
        badge: "Department User Workspace",
        icon: Briefcase,
        defaultTab: "all",
        tabs: [
          { id: "all", label: "All My Cases" },
          { id: "drafts", label: "My Drafts" },
          { id: "submitted", label: "My Submitted Cases" },
          { id: "returned", label: "Returned Cases" },
          { id: "completed", label: "Completed Cases" },
        ],
      };
    }
    if (isEngMgr) {
      return {
        title: "ENGINEERING APPROVAL",
        subtitle: "Final engineering approval for technically reviewed Business Cases.",
        badge: "Engineering Manager Gate",
        icon: ShieldCheck,
        defaultTab: "active",
        tabs: [
          { id: "active", label: "Pending Engineering Approval" },
          { id: "history", label: "Approved by Me / History" },
        ],
      };
    }
    if (isEngineer) {
      return {
        title: "TECHNICAL REVIEW",
        subtitle: "Verify technical requirements, engineering feasibility, and equipment specifications.",
        badge: "Engineer Active Gate",
        icon: Wrench,
        defaultTab: "active",
        tabs: [
          { id: "active", label: "Pending Technical Review" },
          { id: "history", label: "Reviewed by Me / History" },
        ],
      };
    }
    if (isFinance) {
      return {
        title: "FINANCE APPROVALS",
        subtitle: "Capital expenditure verification, ROI validation, NPV modeling, and budgetary gate approvals.",
        badge: "Finance Manager Gate",
        icon: DollarSign,
        defaultTab: "active",
        tabs: [
          { id: "active", label: "Pending Finance Approval" },
          { id: "history", label: "Approved by Me / History" },
        ],
      };
    }
    if (isLegal) {
      return {
        title: "LEGAL BUSINESS CASE REVIEWS",
        subtitle: "Review statutory compliance, supplier agreements, 9-point checklist, and electronic signature execution.",
        badge: "Legal Manager Gate",
        icon: Scale,
        defaultTab: "active",
        tabs: [
          { id: "active", label: "Pending Legal Review" },
          { id: "history", label: "Approved by Me / History" },
        ],
      };
    }
    if (isProcurement) {
      return {
        title: "PROCUREMENT BUSINESS CASE REVIEWS",
        subtitle: "Final commercial review, packaging for RFQ, and competitive sourcing readiness.",
        badge: "Procurement Manager Gate",
        icon: Sparkles,
        defaultTab: "active",
        tabs: [
          { id: "active", label: "Pending Procurement Review" },
          { id: "ready_for_rfq", label: "Ready for RFQ" },
          { id: "completed", label: "Completed / Converted to RFQ" },
        ],
      };
    }
    return {
      title: "BUSINESS CASES REPOSITORY",
      subtitle: "Authoritative justification records, dynamic financial models, and multi-stage approval workflow.",
      badge: "Governance Repository",
      icon: Layers,
      defaultTab: "all",
      tabs: [
        { id: "all", label: "All Cases" },
        { id: "in_review", label: "In Review" },
        { id: "drafts", label: "Drafts" },
        { id: "returned", label: "Returned" },
        { id: "ready_for_rfq", label: "Ready for RFQ" },
      ],
    };
  }, [isDept, isEngineer, isEngMgr, isFinance, isLegal, isProcurement]);

  const [activeTab, setActiveTab] = useState(() => {
    return searchParams.get("tab") || roleScreenConfig.defaultTab;
  });

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (!urlTab && roleScreenConfig.defaultTab !== activeTab) {
      setActiveTab(roleScreenConfig.defaultTab);
    }
  }, [roleScreenConfig.defaultTab, searchParams]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedStage, setSelectedStage] = useState("all");

  const { data: rawCases = [], isLoading, refetch } = useQuery({
    queryKey: ["business-cases-role", rawRole, userEmail],
    queryFn: () => fetchRoleBusinessCases(rawRole, userEmail, { queueType: "all" }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Strict role queue partition helpers
  const isEngMgrActive = (c: BusinessCase) => {
    return (
      c.workflow_status === "Pending Engineering Manager" ||
      (c.current_stage === "Engineering Approval" && c.engineering_status !== "Approved" && !["Draft", "Approved", "Rejected"].includes(c.workflow_status))
    );
  };

  const isEngineerActive = (c: BusinessCase) => {
    const isStatus =
      c.workflow_status === "Pending Engineering" ||
      c.workflow_status === "Pending Technical Review" ||
      c.workflow_status === "Submitted";
    return isStatus && c.workflow_status !== "Pending Engineering Manager";
  };

  const isFinanceActive = (c: BusinessCase) => {
    const isStage =
      c.current_stage === "Finance Approval" ||
      c.current_stage === "FINANCE_APPROVAL" ||
      c.current_stage === "Finance Review";
    const isStatus =
      c.workflow_status === "Pending Finance" ||
      c.workflow_status === "Pending Finance Review" ||
      c.workflow_status === "Revision Required (Finance)" ||
      c.workflow_status === "Revision Required - Finance";
    return isStage && isStatus;
  };

  const isLegalActive = (c: BusinessCase) => {
    const isStage =
      c.current_stage === "Legal Approval" ||
      c.current_stage === "LEGAL_APPROVAL" ||
      c.current_stage === "Legal Review";
    const isStatus =
      c.workflow_status === "Pending Legal" ||
      c.workflow_status === "Pending Legal Review";
    return isStage && isStatus;
  };

  const isProcurementActive = (c: BusinessCase) => {
    const isStage =
      c.current_stage === "Procurement Review" ||
      c.current_stage === "PROCUREMENT_REVIEW";
    return isStage && c.workflow_status === "Pending Procurement";
  };

  // Base role-scoped cases
  const roleScopedCases = useMemo(() => {
    if (isDept) {
      const normEmail = userEmail.trim().toLowerCase();
      return rawCases.filter((c) => {
        if (!normEmail || normEmail === "department@netlink.com") return true;
        const owner = (c.business_owner || (c as any).owner || c.requester || c.created_by || "").toLowerCase();
        return owner.includes(normEmail) || normEmail.includes(owner) || owner === normEmail;
      });
    }
    return rawCases;
  }, [rawCases, isDept, userEmail]);

  // Role tab filtering (STRICT VISIBILITY ENFORCEMENT)
  const tabFilteredCases = useMemo(() => {
    if (isDept) {
      if (activeTab === "drafts") {
        return roleScopedCases.filter((c) => c.workflow_status === "Draft" || c.status === "Draft");
      }
      if (activeTab === "submitted") {
        return roleScopedCases.filter(
          (c) =>
            !["Draft", "Returned"].includes(c.workflow_status) &&
            !c.workflow_status.startsWith("Revision Required") &&
            !["Approved", "Ready for RFQ", "RFQ Created"].includes(c.workflow_status),
        );
      }
      if (activeTab === "returned") {
        return roleScopedCases.filter(
          (c) => c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required"),
        );
      }
      if (activeTab === "completed") {
        return roleScopedCases.filter((c) =>
          ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(c.workflow_status),
        );
      }
      return roleScopedCases;
    }

    if (isEngMgr) {
      if (activeTab === "active") {
        // STRICT: ONLY Engineering Approval pending Engineering Manager
        return roleScopedCases.filter(isEngMgrActive);
      }
      if (activeTab === "history") {
        return roleScopedCases.filter(
          (c) =>
            !isEngMgrActive(c) &&
            (c.engineering_status === "Approved" ||
              [
                "Pending Finance",
                "Pending Finance Review",
                "Pending Legal",
                "Pending Procurement",
                "Ready for RFQ",
                "Approved",
                "RFQ Created",
              ].includes(c.workflow_status)),
        );
      }
      return roleScopedCases;
    }

    if (isEngineer) {
      if (activeTab === "active") {
        // STRICT: ONLY Technical Review pending Engineer
        return roleScopedCases.filter(isEngineerActive);
      }
      if (activeTab === "history") {
        return roleScopedCases.filter(
          (c) =>
            !isEngineerActive(c) &&
            (c.engineering_status === "Approved" ||
              c.engineering_status === "Reviewed" ||
              [
                "Pending Engineering Manager",
                "Pending Finance",
                "Pending Finance Review",
                "Pending Legal",
                "Pending Procurement",
                "Ready for RFQ",
                "Approved",
                "RFQ Created",
              ].includes(c.workflow_status)),
        );
      }
      return roleScopedCases;
    }

    if (isFinance) {
      if (activeTab === "active") {
        // STRICT: ONLY Finance Approval pending Finance Manager
        return roleScopedCases.filter(isFinanceActive);
      }
      if (activeTab === "history") {
        return roleScopedCases.filter(
          (c) =>
            !isFinanceActive(c) &&
            (c.finance_status === "Approved" ||
              [
                "Pending Legal",
                "Pending Procurement",
                "Ready for RFQ",
                "Approved",
                "RFQ Created",
              ].includes(c.workflow_status)),
        );
      }
      return roleScopedCases;
    }

    if (isLegal) {
      if (activeTab === "active") {
        // STRICT: ONLY Legal Review pending Legal Manager
        return roleScopedCases.filter(isLegalActive);
      }
      if (activeTab === "history") {
        return roleScopedCases.filter(
          (c) =>
            !isLegalActive(c) &&
            (c.legal_status === "Approved" ||
              ["Pending Procurement", "Ready for RFQ", "Approved", "RFQ Created"].includes(
                c.workflow_status,
              )),
        );
      }
      return roleScopedCases;
    }

    if (isProcurement) {
      if (activeTab === "active") {
        // STRICT: ONLY Procurement Review pending Procurement Manager
        return roleScopedCases.filter(isProcurementActive);
      }
      if (activeTab === "ready_for_rfq") {
        return roleScopedCases.filter(
          (c) =>
            !c.rfq_id &&
            ["Ready for RFQ", "Procurement Ready", "Approved"].includes(c.workflow_status),
        );
      }
      if (activeTab === "completed") {
        return roleScopedCases.filter(
          (c) => Boolean(c.rfq_id) || c.workflow_status === "RFQ Created",
        );
      }
      return roleScopedCases;
    }

    // Admin / Generic
    if (activeTab === "in_review") {
      return roleScopedCases.filter((c) =>
        [
          "Submitted",
          "Pending Engineering",
          "Pending Engineering Manager",
          "Pending Finance",
          "Pending Finance Review",
          "Pending Legal",
          "Pending Legal Review",
          "Pending Procurement",
        ].includes(c.workflow_status),
      );
    }
    if (activeTab === "drafts") {
      return roleScopedCases.filter((c) => c.workflow_status === "Draft");
    }
    if (activeTab === "returned") {
      return roleScopedCases.filter(
        (c) => c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required"),
      );
    }
    if (activeTab === "ready_for_rfq") {
      return roleScopedCases.filter((c) =>
        ["Approved", "Ready for RFQ", "Procurement Ready"].includes(c.workflow_status),
      );
    }
    return roleScopedCases;
  }, [
    roleScopedCases,
    activeTab,
    isDept,
    isEngineer,
    isEngMgr,
    isFinance,
    isLegal,
    isProcurement,
  ]);

  // Dropdown options
  const departmentOptions = useMemo(() => {
    return Array.from(
      new Set([
        "IT & Digital Transformation",
        "Industrial Operations",
        "Supply Chain & Logistics",
        "Engineering & Maintenance",
        "Procurement",
        ...rawCases.map((c) => c.department).filter(Boolean),
      ]),
    );
  }, [rawCases]);

  // Final search & dropdown filter
  const filteredCases = useMemo(() => {
    return tabFilteredCases.filter((c) => {
      if (selectedDept !== "all" && c.department !== selectedDept) return false;
      if (selectedStatus !== "all") {
        const matchStatus =
          c.workflow_status === selectedStatus ||
          c.status === selectedStatus ||
          c.approval_status === selectedStatus;
        if (!matchStatus) return false;
      }
      if (selectedStage !== "all" && c.current_stage !== selectedStage) return false;

      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase().trim();
        return (
          (c.business_case_id || "").toLowerCase().includes(q) ||
          (c.name || "").toLowerCase().includes(q) ||
          (c.title || "").toLowerCase().includes(q) ||
          (c.department || "").toLowerCase().includes(q) ||
          (c.business_owner || "").toLowerCase().includes(q) ||
          (c.commodity || "").toLowerCase().includes(q) ||
          (c.plant || "").toLowerCase().includes(q) ||
          (c.requester || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tabFilteredCases, selectedDept, selectedStatus, selectedStage, debouncedSearch]);

  // Role-specific KPI metrics
  const roleKpis = useMemo(() => {
    if (isDept) {
      const myTotal = roleScopedCases.length;
      const drafts = roleScopedCases.filter((c) => c.workflow_status === "Draft").length;
      const submitted = roleScopedCases.filter(
        (c) =>
          !["Draft", "Returned"].includes(c.workflow_status) &&
          !c.workflow_status.startsWith("Revision Required") &&
          !["Approved", "Ready for RFQ", "RFQ Created"].includes(c.workflow_status),
      ).length;
      const returned = roleScopedCases.filter(
        (c) => c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required"),
      ).length;
      const completed = roleScopedCases.filter((c) =>
        ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(c.workflow_status),
      ).length;
      return [
        { label: "My Total Cases", value: myTotal, color: "text-slate-900" },
        { label: "My Drafts", value: drafts, color: "text-slate-600" },
        { label: "My Submitted", value: submitted, color: "text-[#1554D1]" },
        { label: "Returned Cases", value: returned, color: "text-amber-600" },
        { label: "Completed", value: completed, color: "text-emerald-600" },
      ];
    }

    if (isEngMgr) {
      const activePending = roleScopedCases.filter(isEngMgrActive).length;
      const approved = roleScopedCases.filter(
        (c) =>
          c.engineering_status === "Approved" ||
          ["Pending Finance", "Pending Legal", "Pending Procurement", "Ready for RFQ", "Approved"].includes(
            c.workflow_status,
          ),
      ).length;
      const highPriority = roleScopedCases.filter(
        (c) => isEngMgrActive(c) && ((c as any).priority === "High" || (c as any).priority === "Critical" || (c as any).priority === "Urgent"),
      ).length;
      return [
        { label: "Pending Engineering Approvals", value: activePending, color: "text-indigo-600" },
        { label: "Approved by Me", value: approved, color: "text-emerald-600" },
        { label: "High Priority Pending", value: highPriority, color: "text-amber-600" },
        { label: "Total Engineering Approval Cases", value: roleScopedCases.length, color: "text-slate-900" },
      ];
    }

    if (isEngineer) {
      const activePending = roleScopedCases.filter(isEngineerActive).length;
      const reviewed = roleScopedCases.filter(
        (c) =>
          c.engineering_status === "Approved" ||
          c.engineering_status === "Reviewed" ||
          [
            "Pending Engineering Manager",
            "Pending Finance",
            "Pending Legal",
            "Pending Procurement",
            "Ready for RFQ",
            "Approved",
          ].includes(c.workflow_status),
      ).length;
      const highPriority = roleScopedCases.filter(
        (c) => isEngineerActive(c) && ((c as any).priority === "High" || (c as any).priority === "Critical" || (c as any).priority === "Urgent"),
      ).length;
      return [
        { label: "Technical Review (Active Gate)", value: activePending, color: "text-indigo-600" },
        { label: "Reviewed by Me", value: reviewed, color: "text-emerald-600" },
        { label: "High Priority Pending", value: highPriority, color: "text-amber-600" },
        { label: "Total Assigned Scope", value: activePending + reviewed, color: "text-slate-900" },
      ];
    }

    if (isFinance) {
      const activePending = roleScopedCases.filter(isFinanceActive);
      const pendingCount = activePending.length;
      const totalCapex = activePending.reduce(
        (sum, c) => sum + (Number(c.capex) || Number(c.budget) || Number(c.total_investment) || 0),
        0,
      );
      const approved = roleScopedCases.filter(
        (c) =>
          c.finance_status === "Approved" ||
          ["Pending Legal", "Pending Procurement", "Ready for RFQ", "Approved"].includes(c.workflow_status),
      ).length;
      const revisions = roleScopedCases.filter(
        (c) => c.workflow_status === "Revision Required (Finance)" || c.workflow_status === "Revision Required - Finance",
      ).length;
      return [
        { label: "Finance Approval (Active Gate)", value: pendingCount, color: "text-indigo-600" },
        { label: "Pending CAPEX ($)", value: `$${totalCapex.toLocaleString()}`, color: "text-slate-900" },
        { label: "Approved by Me", value: approved, color: "text-emerald-600" },
        { label: "Revision Required", value: revisions, color: "text-amber-600" },
      ];
    }

    if (isLegal) {
      const activePending = roleScopedCases.filter(isLegalActive).length;
      const approved = roleScopedCases.filter(
        (c) =>
          c.legal_status === "Approved" ||
          ["Pending Procurement", "Ready for RFQ", "Approved", "RFQ Created"].includes(c.workflow_status),
      ).length;
      return [
        { label: "Legal Reviews (Active Gate)", value: activePending, color: "text-indigo-600" },
        { label: "Approved with E-Sign", value: approved, color: "text-emerald-600" },
        { label: "Active Queue Scope", value: activePending, color: "text-amber-600" },
        { label: "Total Legal Archive", value: activePending + approved, color: "text-slate-900" },
      ];
    }

    if (isProcurement) {
      const activePending = roleScopedCases.filter(isProcurementActive).length;
      const readyForRfq = roleScopedCases.filter(
        (c) => !c.rfq_id && ["Ready for RFQ", "Procurement Ready", "Approved"].includes(c.workflow_status),
      ).length;
      const converted = roleScopedCases.filter(
        (c) => Boolean(c.rfq_id) || c.workflow_status === "RFQ Created",
      ).length;
      const pipelineSpend = roleScopedCases
        .filter((c) => isProcurementActive(c) || ["Ready for RFQ", "Approved"].includes(c.workflow_status))
        .reduce((sum, c) => sum + (Number(c.budget) || Number(c.total_investment) || 0), 0);
      return [
        { label: "Procurement Review (Active Gate)", value: activePending, color: "text-indigo-600" },
        { label: "Ready for RFQ", value: readyForRfq, color: "text-emerald-600" },
        { label: "Converted to RFQ", value: converted, color: "text-sky-700" },
        { label: "Pipeline Budget ($)", value: `$${pipelineSpend.toLocaleString()}`, color: "text-slate-900" },
      ];
    }

    // Admin default
    const total = roleScopedCases.length;
    const drafts = roleScopedCases.filter((c) => c.workflow_status === "Draft").length;
    const inReview = roleScopedCases.filter((c) =>
      [
        "Submitted",
        "Pending Engineering",
        "Pending Engineering Manager",
        "Pending Finance",
        "Pending Finance Review",
        "Pending Legal",
        "Pending Legal Review",
        "Pending Procurement",
      ].includes(c.workflow_status),
    ).length;
    const returned = roleScopedCases.filter(
      (c) => c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required"),
    ).length;
    const ready = roleScopedCases.filter((c) =>
      ["Approved", "Ready for RFQ", "Procurement Ready"].includes(c.workflow_status),
    ).length;
    return [
      { label: "Total Cases", value: total, color: "text-slate-900" },
      { label: "In Review", value: inReview, color: "text-[#1554D1]" },
      { label: "Drafts", value: drafts, color: "text-slate-600" },
      { label: "Returned", value: returned, color: "text-amber-600" },
      { label: "Ready for RFQ", value: ready, color: "text-emerald-600" },
    ];
  }, [
    isDept,
    isEngineer,
    isEngMgr,
    isFinance,
    isLegal,
    isProcurement,
    roleScopedCases,
  ]);

  const isFiltered =
    search.trim() !== "" ||
    selectedStatus !== "all" ||
    selectedStage !== "all" ||
    selectedDept !== "all";

  const clearFilters = () => {
    setSearch("");
    setSelectedStatus("all");
    setSelectedStage("all");
    setSelectedDept("all");
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tabId);
      return next;
    });
  };

  const HeaderIcon = roleScreenConfig.icon;

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 sm:space-y-5 overflow-hidden">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/90 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 shrink-0">
              <HeaderIcon className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
              {roleScreenConfig.title}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200/80 shrink-0">
              {roleScreenConfig.badge}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {roleScreenConfig.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            Refresh
          </button>
          {canCreateBusinessCase && (
            <Link
              to="/intake/business-cases/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#1554D1] hover:bg-[#1245AD] shadow-xs rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Business Case
            </Link>
          )}
        </div>
      </div>

      {/* 2. Role-Specific KPI Cards */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-${roleKpis.length} gap-3 sm:gap-4 w-full min-w-0`}>
        {roleKpis.map((kpi, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 shadow-xs min-w-0"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block truncate">
              {kpi.label}
            </span>
            <p className={`mt-1 text-2xl font-bold tracking-tight ${kpi.color}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* 3. Role-Specific Work Queue Tabs */}
      <div className="border-b border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {roleScreenConfig.tabs.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTabChange(t.id)}
              className={`px-4 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer ${
                isActive
                  ? "border-[#1554D1] text-[#1554D1] bg-blue-50/50"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 4. Search & Filters Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Case ID, title, department, plant, commodity, owner..."
              className="w-full pl-9 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-[#1554D1] focus:outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 md:flex md:items-center shrink-0">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full md:w-44 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-700 focus:bg-white focus:border-[#1554D1] focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Pending Engineering">Pending Engineering</option>
              <option value="Pending Finance">Pending Finance</option>
              <option value="Pending Procurement">Pending Procurement</option>
              <option value="Pending Legal">Pending Legal</option>
              <option value="Returned">Returned</option>
              <option value="Ready for RFQ">Ready for RFQ</option>
              <option value="RFQ Created">RFQ Created</option>
              <option value="Rejected">Rejected</option>
            </select>

            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full md:w-44 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-700 focus:bg-white focus:border-[#1554D1] focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">All Stages</option>
              <option value="Technical Review">Technical Review</option>
              <option value="Engineering Approval">Engineering Approval</option>
              <option value="Finance Approval">Finance Approval</option>
              <option value="Legal Approval">Legal Approval</option>
              <option value="Procurement Review">Procurement Review</option>
              <option value="Ready for RFQ">Ready for RFQ</option>
            </select>

            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="w-full md:w-44 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-700 focus:bg-white focus:border-[#1554D1] focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">All Departments</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors shrink-0 cursor-pointer"
              title="Reset all filters"
            >
              <X className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 5. Professional Responsive Work Queue Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden w-full min-w-0">
        <table className="w-full table-fixed text-left text-xs border-collapse">
          <thead className="border-b border-slate-200 bg-slate-50/90 font-bold uppercase text-slate-500 tracking-wider text-[10.5px]">
            <tr>
              {/* 1. Case ID */}
              <th className="px-3 py-3 w-[105px] lg:w-[115px]">Case ID</th>
              {/* 2. Title */}
              <th className="px-3 py-3 min-w-[150px]">Title</th>
              {/* 3. Department */}
              <th className="px-3 py-3 hidden sm:table-cell sm:w-[115px] lg:w-[130px]">Department</th>
              {/* 4. Plant */}
              <th className="px-3 py-3 hidden xl:table-cell xl:w-[85px]">Plant</th>
              {/* 5. Commodity */}
              <th className="px-3 py-3 hidden xl:table-cell xl:w-[105px]">Commodity</th>
              {/* 6. Requester */}
              <th className="px-3 py-3 hidden 2xl:table-cell 2xl:w-[95px]">Requester</th>
              {/* 7. Business Owner */}
              <th className="px-3 py-3 hidden lg:table-cell lg:w-[115px]">Business Owner</th>
              {/* 8. Estimated Budget */}
              <th className="px-3 py-3 w-[100px] lg:w-[110px] text-right">Estimated Budget</th>
              {/* 9. Priority */}
              <th className="px-3 py-3 w-[75px] lg:w-[85px] text-center">Priority</th>
              {/* 10. Current Stage */}
              <th className="px-3 py-3 hidden md:table-cell md:w-[115px] lg:w-[125px]">Current Stage</th>
              {/* 11. Status */}
              <th className="px-3 py-3 w-[100px] lg:w-[110px] text-center">Status</th>
              {/* 12. Action */}
              <th className="px-3 py-3 w-[95px] lg:w-[105px] text-right">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#1554D1]" />
                  Loading Business Cases queue...
                </td>
              </tr>
            ) : filteredCases.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                    <p className="text-sm font-semibold text-slate-900">
                      {isFiltered ? "No Business Cases match your filter criteria" : "No Business Cases in this queue"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {isFiltered
                        ? "Try adjusting your search query, status, stage, or department filter."
                        : activeTab === "active"
                        ? "You have zero pending cases awaiting your action at this time."
                        : "No Business Cases recorded under this view."}
                    </p>
                    {isFiltered ? (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    ) : canCreateBusinessCase ? (
                      <Link
                        to="/intake/business-cases/new"
                        className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1554D1] hover:bg-[#1245AD] rounded-lg shadow-xs transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Create New Business Case
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              filteredCases.map((c) => {
                const id = c.business_case_id || c.name || "";

                // Determine role-specific action button
                let actionLabel = "View";
                let actionIcon = Eye;
                let actionStyle = "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
                let actionTo = `/intake/business-cases/${id}`;

                if (isDept) {
                  if (c.workflow_status === "Draft" || c.status === "Draft") {
                    actionLabel = "Edit";
                    actionIcon = Edit3;
                    actionStyle = "bg-primary-600 text-white hover:bg-primary-700 shadow-2xs";
                    actionTo = `/intake/business-cases/${id}/edit`;
                  } else if (c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required")) {
                    actionLabel = "Edit & Resubmit";
                    actionIcon = Edit3;
                    actionStyle = "bg-amber-600 text-white hover:bg-amber-700 shadow-2xs";
                    actionTo = `/intake/business-cases/${id}/edit`;
                  } else {
                    actionLabel = "View";
                    actionIcon = Eye;
                    actionStyle = "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
                  }
                } else if (isEngineer) {
                  if (isEngineerActive(c)) {
                    actionLabel = "Review";
                    actionIcon = FileCheck;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  }
                } else if (isEngMgr) {
                  if (isEngMgrActive(c)) {
                    actionLabel = "Review & Approve";
                    actionIcon = ShieldCheck;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  }
                } else if (isFinance) {
                  if (isFinanceActive(c)) {
                    actionLabel = "Review & Approve";
                    actionIcon = DollarSign;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  }
                } else if (isLegal) {
                  if (isLegalActive(c)) {
                    actionLabel = "Review";
                    actionIcon = FileCheck;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  }
                } else if (isProcurement) {
                  if (isProcurementActive(c)) {
                    actionLabel = "Review";
                    actionIcon = FileCheck;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  } else if (
                    !c.rfq_id &&
                    ["Ready for RFQ", "Procurement Ready", "Approved"].includes(c.workflow_status)
                  ) {
                    actionLabel = "Create RFQ";
                    actionIcon = Sparkles;
                    actionStyle = "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs";
                  } else if (c.rfq_id) {
                    actionLabel = "View RFQ";
                    actionIcon = ArrowUpRight;
                    actionStyle = "bg-indigo-50 border border-indigo-200 text-indigo-800 hover:bg-indigo-100";
                    actionTo = `/sourcing/rfq/${c.rfq_id}`;
                  }
                } else if (isAdmin) {
                  const isAnyActive =
                    isEngineerActive(c) ||
                    isEngMgrActive(c) ||
                    isFinanceActive(c) ||
                    isLegalActive(c) ||
                    isProcurementActive(c);
                  if (isAnyActive) {
                    actionLabel = "Review";
                    actionIcon = FileCheck;
                    actionStyle = "bg-[#1554D1] text-white hover:bg-[#1245AD] shadow-2xs";
                  }
                }

                const ActionIcon = actionIcon;

                return (
                  <tr key={id} className="hover:bg-slate-50/80 transition-colors group">
                    {/* 1. Case ID */}
                    <td className="px-3 py-2.5 sm:py-3 font-mono font-bold text-[#1554D1] truncate">
                      <Link
                        to={`/intake/business-cases/${id}`}
                        className="hover:underline inline-flex items-center gap-0.5 truncate"
                        title={id}
                      >
                        <span className="truncate">{id}</span>
                        <ArrowUpRight className="h-3 w-3 text-slate-400 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </td>

                    {/* 2. Title */}
                    <td className="px-3 py-2.5 sm:py-3 min-w-0">
                      <Link
                        to={`/intake/business-cases/${id}`}
                        className="font-semibold text-slate-900 hover:text-[#1554D1] line-clamp-2 block leading-snug transition-colors"
                        title={c.title}
                      >
                        {c.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 mt-0.5">
                        <span className="sm:hidden font-medium text-slate-600">{c.department}</span>
                        {c.business_owner && (
                          <span className="lg:hidden text-slate-500">Owner: {c.business_owner}</span>
                        )}
                        {c.commodity && (
                          <span className="xl:hidden text-slate-500">• {c.commodity}</span>
                        )}
                        {c.plant && <span className="xl:hidden text-slate-500">• Plant: {c.plant}</span>}
                        {c.current_stage && (
                          <span className="md:hidden text-slate-500">• Stage: {c.current_stage}</span>
                        )}
                      </div>
                    </td>

                    {/* 3. Department */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-700 truncate hidden sm:table-cell"
                      title={c.department}
                    >
                      {c.department || "—"}
                    </td>

                    {/* 4. Plant */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-600 truncate hidden xl:table-cell"
                      title={c.plant}
                    >
                      {c.plant || "—"}
                    </td>

                    {/* 5. Commodity */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-600 truncate hidden xl:table-cell"
                      title={c.commodity}
                    >
                      {c.commodity || "Direct Materials"}
                    </td>

                    {/* 6. Requester */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-600 truncate hidden 2xl:table-cell"
                      title={c.requester || c.created_by}
                    >
                      {c.requester || c.created_by || "—"}
                    </td>

                    {/* 7. Business Owner */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-700 truncate hidden lg:table-cell"
                      title={c.business_owner}
                    >
                      {c.business_owner || "—"}
                    </td>

                    {/* 8. Estimated Budget */}
                    <td className="px-3 py-2.5 sm:py-3 font-semibold text-slate-900 text-right whitespace-nowrap">
                      {c.currency || "USD"}{" "}
                      {(
                        Number(c.budget) ||
                        Number(c.total_investment) ||
                        Number(c.capex) ||
                        0
                      ).toLocaleString()}
                    </td>

                    {/* 9. Priority */}
                    <td className="px-3 py-2.5 sm:py-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.priority === "Critical"
                            ? "bg-rose-50 text-rose-700 border border-rose-200/80"
                            : c.priority === "High"
                            ? "bg-amber-50 text-amber-700 border border-amber-200/80"
                            : c.priority === "Low"
                            ? "bg-slate-100 text-slate-600 border border-slate-200/80"
                            : "bg-blue-50 text-[#1554D1] border border-blue-200/80"
                        }`}
                      >
                        {c.priority || "Medium"}
                      </span>
                    </td>

                    {/* 10. Current Stage */}
                    <td
                      className="px-3 py-2.5 sm:py-3 text-slate-700 font-medium truncate hidden md:table-cell"
                      title={c.current_stage || c.workflow_status}
                    >
                      {c.current_stage || c.workflow_status || "—"}
                    </td>

                    {/* 11. Status */}
                    <td className="px-3 py-2.5 sm:py-3 text-center whitespace-nowrap">
                      <div className="inline-flex justify-center max-w-full">
                        <IntakeApprovalBadge status={c.workflow_status} size="sm" />
                      </div>
                    </td>

                    {/* 12. Action */}
                    <td className="px-3 py-2.5 sm:py-3 text-right whitespace-nowrap">
                      <Link
                        to={actionTo}
                        className={`inline-flex items-center justify-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${actionStyle}`}
                      >
                        <ActionIcon className="h-3 w-3" />
                        {actionLabel}
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
