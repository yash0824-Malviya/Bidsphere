import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileCheck,
  FileSearch,
  FileText,
  Gavel,
  History,
  PenTool,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { APPROVAL_WORKFLOW_QUERY_KEY } from "../../api/approvalWorkflow";
import { fetchBusinessCases } from "../../api/businessIntake";
import { canStartLegalSignature, isLegalReviewExecuted } from "../../types/legalEsign";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatCurrencyCompact, formatDate } from "../../utils/format";
import { daysUntil } from "../../utils/upcomingDeliveries";
import { Skeleton } from "../Skeleton";

function computeDaysPending(createdDate?: string | null): number {
  if (!createdDate) return 0;
  const created = new Date(createdDate).getTime();
  if (isNaN(created)) return 0;
  const now = Date.now();
  const diff = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

const PANEL = "legal-panel flex h-full flex-col overflow-hidden bg-white rounded-xl border border-slate-200/80 shadow-2xs";

function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  to,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  to?: string;
  badge?: string | number;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5 sm:px-6">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold leading-tight text-[#0F2745]">
              {title}
            </h3>
            {badge != null && Number(badge) > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                {badge}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-[13px] text-[#64748B]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {to ? (
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

interface Props {
  greetingName: string;
}

/**
 * Enterprise Legal Manager Dashboard — Legal & Compliance Command Center
 */
export default function LegalDashboard({ greetingName: _greetingName }: Props) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [contractTab, setContractTab] = useState<"All" | "Active" | "Pending" | "Expiring">("All");
  const [docTab, setDocTab] = useState<"All" | "MSA" | "NDA" | "Insurance" | "Compliance">("All");

  const legalDocsQuery = useQuery({
    queryKey: ["legal-docs-all"],
    queryFn: () => getAllLegalDocs(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const legalDocs = legalDocsQuery.data ?? [];

  const businessCasesQuery = useQuery({
    queryKey: ["business-cases"],
    queryFn: () => fetchBusinessCases(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const businessCases = businessCasesQuery.data ?? [];

  const pendingLegalBusinessCases = useMemo(() => {
    return businessCases.filter((bc) => {
      const st = (bc.workflow_status || bc.status || "").toLowerCase().trim();
      const stage = (bc.current_stage || "").toLowerCase().trim();
      return (
        st === "pending legal" ||
        st === "pending legal review" ||
        stage === "legal" ||
        stage === "legal approval" ||
        stage === "legal review"
      );
    });
  }, [businessCases]);

  // ==========================================
  // KPI Metrics Calculation
  // ==========================================
  const kpis = useMemo(() => {
    const pendingReviews = legalDocs.filter((d) => d.review_status === "Pending").length;
    const approvedReviews = legalDocs.filter((d) => d.review_status === "Approved").length;
    const rejectedReviews = legalDocs.filter((d) => d.review_status === "Rejected").length;

    // Supplier docs pending verification
    let pendingDocsCount = 0;
    let expiringCount = 0;
    for (const d of legalDocs) {
      if (d.terms_file_url && !d.terms_approved) pendingDocsCount++;
      if (d.warranty_file_url && !d.warranty_approved) pendingDocsCount++;
      if (d.insurance_file_url && !d.insurance_approved) pendingDocsCount++;
      if (d.valid_till) {
        const remaining = daysUntil(d.valid_till);
        if (remaining != null && remaining >= 0 && remaining <= 30) {
          expiringCount++;
        }
      }
    }

    const pendingEsigns = legalDocs.filter((d) => canStartLegalSignature(d) && !isLegalReviewExecuted(d)).length;
    const contractsPending = legalDocs.filter((d) => d.review_status === "Pending" && (d.grand_total ?? 0) > 0).length;

    return {
      pendingReviews,
      approvedReviews,
      rejectedReviews,
      pendingDocsCount,
      contractsPending,
      pendingEsigns,
      expiringCount,
      legalHolds: rejectedReviews,
    };
  }, [legalDocs]);

  // ==========================================
  // RFQ Review Queue (Enriched - Pending Legal Review only)
  // ==========================================
  const rfqQueue = useMemo(() => {
    return legalDocs
      .filter((doc) => doc.review_status === "Pending" && doc.current_owner !== "Procurement")
      .map((doc) => {
        let docCount = 0;
        let totalDocs = 3;
        if (doc.terms_file_url) docCount++;
        if (doc.warranty_file_url) docCount++;
        if (doc.insurance_file_url) docCount++;

        const isHighPriority = (doc.grand_total ?? 0) > 10000;

        return {
          ...doc,
          title: doc.rfq_name ? `${doc.rfq_name} Sourcing Review` : "Supplier Documentation Review",
          department: "Procurement / Operations",
          targetDate: doc.valid_till || doc.submission_date || "",
          docSummary: `${docCount}/${totalDocs} Documents`,
          priority: isHighPriority ? ("High" as const) : ("Standard" as const),
        };
      });
  }, [legalDocs]);

  // ==========================================
  // Supplier Documentation Items
  // ==========================================
  const supplierDocs = useMemo(() => {
    type DocRow = {
      key: string;
      supplier: string;
      docType: string;
      docNumber: string;
      issuedDate: string;
      expiryDate: string;
      status: string;
      rfqRef: string;
      sqName: string;
      category: "MSA" | "NDA" | "Insurance" | "Compliance";
    };

    const rows: DocRow[] = [];

    legalDocs.forEach((d, idx) => {
      if (d.terms_file_url) {
        rows.push({
          key: `terms-${d.sq_name}-${idx}`,
          supplier: d.supplier,
          docType: "Master Terms & Conditions",
          docNumber: `DOC-TRM-${1000 + idx}`,
          issuedDate: d.submission_date || "",
          expiryDate: d.valid_till || "",
          status: d.terms_approved ? "Approved" : d.review_status === "Rejected" ? "Rejected" : "Pending Review",
          rfqRef: d.rfq_name || d.sq_name,
          sqName: d.sq_name,
          category: "MSA",
        });
      }
      if (d.insurance_file_url) {
        rows.push({
          key: `ins-${d.sq_name}-${idx}`,
          supplier: d.supplier,
          docType: "Liability Insurance Certificate",
          docNumber: `DOC-INS-${2000 + idx}`,
          issuedDate: d.submission_date || "",
          expiryDate: d.valid_till || "",
          status: d.insurance_approved ? "Approved" : "Pending Review",
          rfqRef: d.rfq_name || d.sq_name,
          sqName: d.sq_name,
          category: "Insurance",
        });
      }
      if (d.warranty_file_url) {
        rows.push({
          key: `warr-${d.sq_name}-${idx}`,
          supplier: d.supplier,
          docType: "Quality & Compliance Warranty",
          docNumber: `DOC-WRN-${3000 + idx}`,
          issuedDate: d.submission_date || "",
          expiryDate: d.valid_till || "",
          status: d.warranty_approved ? "Approved" : "Pending Review",
          rfqRef: d.rfq_name || d.sq_name,
          sqName: d.sq_name,
          category: "Compliance",
        });
      }
    });

    if (docTab === "All") return rows;
    return rows.filter((r) => r.category === docTab);
  }, [legalDocs, docTab]);

  // ==========================================
  // Contracts Overview Items
  // ==========================================
  const contracts = useMemo(() => {
    return legalDocs.map((d, i) => {
      const remaining = daysUntil(d.valid_till);
      const isExpiring = remaining != null && remaining >= 0 && remaining <= 30;
      const isExpired = remaining != null && remaining < 0;

      let status = isLegalReviewExecuted(d) ? "Active" : "Pending Review";
      if (d.review_status === "Pending") status = "Pending Review";
      else if (d.review_status === "Rejected") status = "Under Amendment";
      else if (isLegalReviewExecuted(d) && isExpired) status = "Expired";
      else if (isLegalReviewExecuted(d) && isExpiring) status = "Expiring Soon";

      return {
        number: `CTR-2026-${String(100 + i).padStart(4, "0")}`,
        supplier: d.supplier,
        type: (d.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Agreement",
        startDate: d.submission_date || "2026-01-15",
        endDate: d.valid_till || "2026-12-31",
        value: d.grand_total ?? 0,
        status,
        sqName: d.sq_name,
      };
    });
  }, [legalDocs]);

  const filteredContracts = useMemo(() => {
    if (contractTab === "All") return contracts;
    if (contractTab === "Active") return contracts.filter((c) => c.status === "Active");
    if (contractTab === "Pending") return contracts.filter((c) => c.status === "Pending Review");
    if (contractTab === "Expiring") return contracts.filter((c) => c.status === "Expiring Soon" || c.status === "Expired");
    return contracts;
  }, [contracts, contractTab]);

  // ==========================================
  // Upcoming Deadlines
  // ==========================================
  const upcomingDeadlines = useMemo(() => {
    type DeadlineRow = {
      docTitle: string;
      supplier: string;
      deadline: string;
      daysRemaining: number | null;
      risk: "High" | "Medium" | "Low";
      sqName: string;
    };

    const rows: DeadlineRow[] = [];

    for (const d of legalDocs) {
      if (!d.valid_till) continue;
      const rem = daysUntil(d.valid_till);
      const risk =
        rem != null && rem < 0
          ? ("High" as const)
          : rem != null && rem <= 7
            ? ("High" as const)
            : rem != null && rem <= 30
              ? ("Medium" as const)
              : ("Low" as const);

      rows.push({
        docTitle: `${d.supplier} Agreement Expiration`,
        supplier: d.supplier,
        deadline: d.valid_till,
        daysRemaining: rem,
        risk,
        sqName: d.sq_name,
      });
    }

    return rows.sort((a, b) => {
      if (a.daysRemaining == null && b.daysRemaining == null) return 0;
      if (a.daysRemaining == null) return 1;
      if (b.daysRemaining == null) return -1;
      return a.daysRemaining - b.daysRemaining;
    }).slice(0, 6);
  }, [legalDocs]);

  // ==========================================
  // Recent Legal Activity Feed
  // ==========================================
  const recentActivities = useMemo(() => {
    return legalDocs
      .filter((d) => d.review_status !== "Pending" || d.modified)
      .sort((a, b) => (b.approved_on || b.modified || "").localeCompare(a.approved_on || a.modified || ""))
      .slice(0, 6);
  }, [legalDocs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["legal-docs-all"] }),
        queryClient.invalidateQueries({ queryKey: [APPROVAL_WORKFLOW_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["legal-ecrs-list"] }),
        queryClient.invalidateQueries({ queryKey: ["legal-suppliers-list"] }),
        queryClient.invalidateQueries({ queryKey: ["business-cases"] }),
      ]);
      setLastRefreshedAt(new Date());
    } finally {
      setTimeout(() => setIsRefreshing(false), 450);
    }
  };

  return (
    <div className="dashboard-stack legal-dashboard space-y-5">
      {/* ============================================================== */}
      {/* PAGE HEADER                                                    */}
      {/* ============================================================== */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Legal Manager Dashboard
            </h1>
            <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-700/10">
              Legal &amp; Compliance Control Center
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Review RFQ legal requirements, supplier documentation, compliance, and approvals before procurement can proceed.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <span className="text-xs text-slate-400">
            Last updated:{" "}
            {lastRefreshedAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
          >
            <RotateCcw
              className={`h-3.5 w-3.5 text-slate-500 ${
                isRefreshing ? "animate-spin text-primary-600" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 5 PRIMARY KPI CARDS (RFQ & Legal Sourcing Focus)               */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Card 1: RFQs Awaiting Legal Review */}
        <Link
          to="/legal/reviews"
          className="group relative flex flex-col justify-between rounded-xl border border-amber-200/80 bg-linear-to-b from-amber-50/20 to-white p-4 shadow-2xs transition hover:border-amber-300 hover:shadow-xs no-underline"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight text-slate-600">
                RFQs Awaiting Legal Review
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200/60">
                <FileSearch className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {kpis.pendingReviews}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">RFQs requiring legal review</p>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-primary-700 group-hover:text-primary-800">
            <span>Review Queue</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Card 2: Supplier Documents Pending */}
        <Link
          to="/legal/reviews"
          className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs no-underline"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight text-slate-600">
                Supplier Documents Pending
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-200/60">
                <FileText className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {kpis.pendingDocsCount}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Documents awaiting verification</p>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-primary-700 group-hover:text-primary-800">
            <span>Review Documents</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Card 3: Legal Exceptions */}
        <Link
          to="/legal/reviews"
          className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs no-underline"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight text-slate-600">
                Legal Exceptions
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-200/60">
                <ShieldAlert className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {kpis.legalHolds}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Open legal issues or exceptions</p>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-primary-700 group-hover:text-primary-800">
            <span>View Exceptions</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Card 4: RFQs Approved */}
        <Link
          to="/legal/reviews"
          className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs no-underline"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight text-slate-600">
                RFQs Approved
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {kpis.approvedReviews}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Approved for procurement flow</p>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-emerald-700 group-hover:text-emerald-800">
            <span>View Approved</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Card 5: RFQs Requiring Clarification */}
        <Link
          to="/legal/reviews"
          className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs no-underline"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight text-slate-600">
                RFQs Requiring Clarification
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200/60">
                <Clock className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {kpis.rejectedReviews}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Clarifications &amp; revisions</p>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-amber-700 group-hover:text-amber-800">
            <span>View Revisions</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      </div>

      {/* ============================================================== */}
      {/* BUSINESS CASE — LEGAL ACTION REQUIRED (Intake Gate Workflow)   */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-indigo-200/80 bg-linear-to-b from-indigo-50/40 via-white to-white p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-indigo-100 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Briefcase className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold tracking-tight text-slate-900">
                  BUSINESS CASE — LEGAL ACTION REQUIRED
                </h2>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                  Active Stage Gate
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Business Cases pending legal compliance, regulatory review, and electronic signature before procurement routing.
              </p>
            </div>
          </div>

          <Link
            to="/intake/business-cases"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 hover:text-indigo-900 transition no-underline"
          >
            Review Business Cases <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Counter KPI Card */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-2xs">
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-slate-600">
                Business Cases Awaiting Legal Review
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Scale className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-indigo-950 tabular-nums">
              {businessCasesQuery.isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                pendingLegalBusinessCases.length
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Sequential workflow: Finance Approved &rarr; Legal Manager Active
            </p>
          </div>
        </div>

        {/* Pending Legal Review Queue Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50/70">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Pending Legal Review
              </h3>
              <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                {pendingLegalBusinessCases.length}
              </span>
            </div>
            <span className="text-xs text-slate-500">
              Review legal requirements, compliance documents, and provide e-sign approval
            </span>
          </div>

          {businessCasesQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          ) : pendingLegalBusinessCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              <p className="text-sm font-semibold text-slate-800">
                No Business Cases currently waiting for legal review
              </p>
              <p className="text-xs text-slate-500">
                All business case intake requests have passed legal compliance or are waiting on earlier workflow stages.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="px-3.5 py-3">Business Case Number</th>
                    <th className="px-3.5 py-3">Business Case Title</th>
                    <th className="px-3.5 py-3">Department</th>
                    <th className="px-3.5 py-3">Requester</th>
                    <th className="px-3.5 py-3">Priority</th>
                    <th className="px-3.5 py-3">Budget</th>
                    <th className="px-3.5 py-3">Current Stage</th>
                    <th className="px-3.5 py-3">Submitted Date</th>
                    <th className="px-3.5 py-3">Required Date</th>
                    <th className="px-3.5 py-3 text-center">Days Pending</th>
                    <th className="px-3.5 py-3">Status</th>
                    <th className="px-3.5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingLegalBusinessCases.map((c) => {
                    const caseId = c.business_case_id || c.name;
                    const budget = c.total_budget || c.budget || c.capex || 0;
                    const daysPending = computeDaysPending(c.creation || c.submitted_date || c.creation_date);
                    return (
                      <tr key={caseId} className="hover:bg-indigo-50/30 transition-colors">
                        <td className="px-3.5 py-3 font-mono font-bold text-indigo-900 whitespace-nowrap">
                          <Link
                            to={`/intake/business-cases/${caseId}`}
                            className="no-underline hover:underline text-indigo-700"
                          >
                            {caseId}
                          </Link>
                        </td>
                        <td className="px-3.5 py-3 font-medium text-slate-900 max-w-[220px] truncate" title={c.title}>
                          {c.title}
                        </td>
                        <td className="px-3.5 py-3 text-slate-600 max-w-[140px] truncate" title={c.department}>
                          {c.department || "—"}
                        </td>
                        <td className="px-3.5 py-3 text-slate-600 max-w-[140px] truncate" title={c.requester || c.business_owner}>
                          {c.requester || c.business_owner || "—"}
                        </td>
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              (c.priority as string) === "Urgent" || c.priority === "Critical"
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : c.priority === "High"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {c.priority || "Standard"}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {budget > 0 ? `$${Number(budget).toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 border border-violet-200">
                            {c.current_stage || "Legal Approval"}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                          {c.submitted_date || c.creation || c.creation_date ? formatDate(c.submitted_date || c.creation || c.creation_date) : "—"}
                        </td>
                        <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                          {c.required_by_date || c.required_delivery_date || c.required_date ? formatDate(c.required_by_date || c.required_delivery_date || c.required_date) : "—"}
                        </td>
                        <td className="px-3.5 py-3 text-center font-mono font-medium text-slate-700 whitespace-nowrap">
                          {daysPending}d
                        </td>
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                            {c.workflow_status || "Pending Legal"}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-right whitespace-nowrap">
                          <Link
                            to={`/intake/business-cases/${caseId}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 transition-colors no-underline"
                          >
                            Review <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* LEGAL ATTENTION REQUIRED (Most Important Action Area)          */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-slate-200/90 bg-linear-to-r from-slate-50/70 via-white to-slate-50/70 p-4 shadow-2xs">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-violet-700" />
            <h2 className="text-sm font-bold tracking-tight text-slate-900">
              LEGAL ATTENTION REQUIRED
            </h2>
            <span className="text-xs text-slate-500">
              · Items requiring legal action before procurement activities can proceed
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Action 1 */}
          <Link
            to="/legal/reviews"
            className="group flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 shadow-2xs transition hover:border-amber-300 hover:bg-amber-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                RFQs Awaiting Legal Review
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-amber-900 tabular-nums">
                  {kpis.pendingReviews} RFQs
                </span>
                <span className="text-xs font-semibold text-amber-700">High Priority</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* Action 2 */}
          <Link
            to="/legal/supplier-documents"
            className="group flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                Supplier Documents Pending
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-blue-900 tabular-nums">
                  {kpis.pendingDocsCount} Docs
                </span>
                <span className="text-xs text-blue-700">Verification</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* Action 3 */}
          <Link
            to="/legal/contracts/review"
            className="group flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50/40 p-3.5 shadow-2xs transition hover:border-violet-300 hover:bg-violet-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
                Contracts Awaiting Approval
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-violet-900 tabular-nums">
                  {kpis.contractsPending} Contracts
                </span>
                <span className="text-xs text-violet-700">Terms check</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          {/* Action 4 */}
          <Link
            to="/legal/esignatures/pending"
            className="group flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50/40 p-3.5 shadow-2xs transition hover:border-sky-300 hover:bg-sky-50/70 no-underline"
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700">
                E-Signatures Pending
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-bold text-sky-900 tabular-nums">
                  {kpis.pendingEsigns} Pending
                </span>
                <span className="text-xs text-sky-700">Signature queue</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 group-hover:underline">
              Review <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        </div>
      </div>

      {/* ============================================================== */}
      {/* RFQ LEGAL REVIEW QUEUE (Most Important New Functional Area)    */}
      {/* ============================================================== */}
      <div className={PANEL}>
        <PanelHeader
          title="RFQ Legal Review Queue"
          subtitle="Upcoming RFQs requiring legal review of supplier and sourcing documentation."
          icon={Gavel}
          to="/legal/reviews"
          badge={kpis.pendingReviews}
        />
        {legalDocsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : rfqQueue.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            <p className="text-sm font-medium text-slate-800">
              No RFQs currently waiting for legal review
            </p>
            <p className="text-xs text-slate-500">
              All supplier proposals have passed legal review requirements.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-full overflow-hidden">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                <tr>
                  <th className="px-3 py-2.5">RFQ #</th>
                  <th className="px-3 py-2.5">Supplier Quotation #</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Submission Date</th>
                  <th className="px-3 py-2.5">Workflow Stage</th>
                  <th className="px-3 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Procurement Manager</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rfqQueue.slice(0, 8).map((row) => (
                  <tr
                    key={row.sq_name}
                    className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]"
                  >
                    <td className="truncate px-3 py-2.5 font-mono text-xs font-semibold text-[#1F3A6D]">
                      <Link
                        to={`/legal/review/${encodeURIComponent(row.sq_name)}`}
                        className="no-underline hover:underline"
                        title={row.rfq_name || row.sq_name}
                      >
                        {row.rfq_name || row.sq_name}
                      </Link>
                    </td>
                    <td className="truncate px-3 py-2.5 font-mono text-xs text-slate-600" title={row.sq_name}>
                      {row.sq_name || "—"}
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs font-medium text-slate-900" title={row.supplier}>
                      {row.supplier}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">
                      {row.submission_date ? formatDate(row.submission_date) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                        Legal Review
                      </span>
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs text-slate-600" title={row.company || "Bidsphere"}>
                      {row.company || "Bidsphere"}
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs text-slate-700" title={row.procurement_manager || "Procurement Manager"}>
                      {row.procurement_manager || "Procurement Manager"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          row.review_status === "Approved"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : row.review_status === "Rejected"
                              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {row.review_status === "Pending" ? "Pending Legal Review" : row.review_status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(row.sq_name)}`}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary-700 no-underline hover:underline"
                      >
                        Review <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* SUPPLIER DOCUMENTATION REVIEW + CONTRACT OVERVIEW               */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Supplier Documentation Review */}
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold leading-tight text-[#0F2745]">
                  Supplier Documentation Review
                </h3>
                <p className="mt-0.5 text-[13px] text-[#64748B]">
                  Legal and compliance documents submitted by suppliers
                </p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
              {(["All", "MSA", "Insurance", "Compliance"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDocTab(tab)}
                  className={`rounded-md px-2 py-0.5 transition ${
                    docTab === tab
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {supplierDocs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
              No supplier documentation records found
            </div>
          ) : (
            <div className="min-h-0 flex-1 w-full max-w-full overflow-hidden">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[28%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <tr>
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5">Document Type</th>
                    <th className="px-3 py-2.5">Expiry Date</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierDocs.slice(0, 6).map((doc) => (
                    <tr
                      key={doc.key}
                      className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-medium text-slate-900" title={doc.supplier}>
                        {doc.supplier}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs text-slate-700 font-semibold" title={doc.docType}>
                        {doc.docType}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">
                        {doc.expiryDate ? formatDate(doc.expiryDate) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            doc.status === "Approved"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {doc.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link
                          to={`/legal/review/${encodeURIComponent(doc.sqName)}`}
                          className="text-[12px] font-semibold text-primary-700 no-underline hover:underline"
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Contract Overview */}
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FA] text-[#1F3A6D]">
                <FileCheck className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold leading-tight text-[#0F2745]">
                  Contract Overview
                </h3>
                <p className="mt-0.5 text-[13px] text-[#64748B]">
                  Active and pending commercial agreements
                </p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
              {(["All", "Active", "Pending", "Expiring"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setContractTab(tab)}
                  className={`rounded-md px-2 py-0.5 transition ${
                    contractTab === tab
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
            {/* 4 Summary Tiles */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg bg-slate-50 p-2.5 border border-slate-100 text-center mb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Active
                </span>
                <p className="text-sm font-bold text-slate-900">
                  {contracts.filter((c) => c.status === "Active").length}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Pending
                </span>
                <p className="text-sm font-bold text-amber-700">
                  {contracts.filter((c) => c.status === "Pending Review").length}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Expiring
                </span>
                <p className="text-sm font-bold text-rose-700">
                  {contracts.filter((c) => c.status === "Expiring Soon").length}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Amendment
                </span>
                <p className="text-sm font-bold text-violet-700">
                  {contracts.filter((c) => c.status === "Under Amendment").length}
                </p>
              </div>
            </div>

            {filteredContracts.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-6 text-[13px] text-[#64748B]">
                No contracts match the selected filter
              </div>
            ) : (
              <div className="w-full max-w-full overflow-hidden">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[30%]" />
                    <col className="w-[16%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <tr className="border-b border-slate-100">
                      <th className="py-2 px-2">Contract #</th>
                      <th className="py-2 px-2">Supplier</th>
                      <th className="py-2 px-2 text-right">Value</th>
                      <th className="py-2 px-2">Status</th>
                      <th className="py-2 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContracts.slice(0, 5).map((c) => (
                      <tr key={c.number} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="truncate py-2 px-2 font-semibold text-primary-700 text-xs" title={c.number}>{c.number}</td>
                        <td className="truncate py-2 px-2 text-slate-800 text-xs" title={c.supplier}>{c.supplier}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs font-semibold text-slate-900">
                          {formatCurrencyCompact(c.value)}
                        </td>
                        <td className="py-2 px-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Link
                            to={`/legal/review/${encodeURIComponent(c.sqName)}`}
                            className="text-xs font-semibold text-primary-700 no-underline hover:underline"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* E-SIGNATURE CENTER                                             */}
      {/* ============================================================== */}
      <div className={PANEL}>
        <PanelHeader
          title="E-Signature Center"
          subtitle="Electronic signatures on supplier agreements, NDAs and contractual addendums."
          icon={PenTool}
          to="/legal/esignatures/pending"
          badge={kpis.pendingEsigns}
        />
        <div className="p-4 sm:p-5">
          {/* Status Buckets */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 rounded-lg bg-slate-50 p-3 border border-slate-100 text-center mb-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Pending
              </span>
              <p className="text-sm font-bold text-amber-700">
                {kpis.pendingEsigns}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Sent
              </span>
              <p className="text-sm font-bold text-blue-700">
                {legalDocs.filter((d) => d.review_status === "Pending").length}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Partially Signed
              </span>
              <p className="text-sm font-bold text-sky-700">
                {legalDocs.filter((d) => d.terms_approved && !d.warranty_approved).length}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Fully Signed
              </span>
              <p className="text-sm font-bold text-emerald-700">
                {kpis.approvedReviews}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Declined
              </span>
              <p className="text-sm font-bold text-rose-700">
                {kpis.rejectedReviews}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Expired
              </span>
              <p className="text-sm font-bold text-slate-600">
                {legalDocs.filter((d) => {
                  const rem = daysUntil(d.valid_till);
                  return rem != null && rem < 0;
                }).length}
              </p>
            </div>
          </div>

          {/* Table */}
          {legalDocs.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[13px] text-slate-500">
              No signature records found
            </div>
          ) : (
            <div className="w-full max-w-full overflow-hidden">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="py-2 px-2.5">Document</th>
                    <th className="py-2 px-2.5">Supplier</th>
                    <th className="py-2 px-2.5">Document Type</th>
                    <th className="py-2 px-2.5">Sent Date</th>
                    <th className="py-2 px-2.5">Status</th>
                    <th className="py-2 px-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {legalDocs.slice(0, 5).map((doc, idx) => {
                    const isFullySigned = isLegalReviewExecuted(doc);
                    const isDeclined = doc.review_status === "Rejected";
                    const statusText = isFullySigned
                      ? "Fully Signed"
                      : isDeclined
                        ? "Declined"
                        : canStartLegalSignature(doc) ? "Pending Signature" : "Review / Approval Required";

                    return (
                      <tr key={doc.sq_name + idx} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="truncate py-2 px-2.5 font-semibold text-primary-700 text-xs" title={doc.rfq_name ? `${doc.rfq_name} Terms` : "Supplier Master Agreement"}>
                          {doc.rfq_name ? `${doc.rfq_name} Terms` : "Supplier Master Agreement"}
                        </td>
                        <td className="truncate py-2 px-2.5 text-slate-800 text-xs font-medium" title={doc.supplier}>
                          {doc.supplier}
                        </td>
                        <td className="truncate py-2 px-2.5 text-slate-600 text-xs" title={(doc.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Terms"}>
                          {(doc.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Terms"}
                        </td>
                        <td className="whitespace-nowrap py-2 px-2.5 text-slate-500 text-xs">
                          {doc.submission_date ? formatDate(doc.submission_date) : "—"}
                        </td>
                        <td className="py-2 px-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              isFullySigned
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : isDeclined
                                  ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                                  : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            }`}
                          >
                            {statusText}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          <Link
                            to={`/legal/review/${encodeURIComponent(doc.sq_name)}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 no-underline hover:underline"
                          >
                            View <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* UPCOMING DEADLINES + RECENT LEGAL ACTIVITY                     */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Upcoming Legal Deadlines */}
        <div className={PANEL}>
          <PanelHeader
            title="Upcoming Legal Deadlines"
            subtitle="Outstanding documents and contract expirations sorted by urgency"
            icon={CalendarClock}
            to="/legal/reviews"
            badge={upcomingDeadlines.length}
          />
          {upcomingDeadlines.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
              No upcoming legal deadlines
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-[#F1F5F9] overflow-y-auto">
              {upcomingDeadlines.map((item, i) => (
                <li key={i}>
                  <Link
                    to={`/legal/review/${encodeURIComponent(item.sqName)}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 no-underline transition hover:bg-[#F8FAFC]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#1E293B]">
                        {item.docTitle}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-[#64748B]">
                        {item.supplier} · {formatDate(item.deadline)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          item.risk === "High"
                            ? "bg-rose-50 text-rose-700"
                            : item.risk === "Medium"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {item.daysRemaining != null && item.daysRemaining < 0
                          ? `${Math.abs(item.daysRemaining)}d overdue`
                          : item.daysRemaining === 0
                            ? "Due today"
                            : `${item.daysRemaining}d remaining`}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Legal Activity */}
        <div className={PANEL}>
          <PanelHeader
            title="Recent Legal Activity"
            subtitle="Timeline of recent legal decisions, approvals and revisions"
            icon={History}
            to="/legal/reviews"
          />
          {recentActivities.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-[13px] text-[#64748B]">
              No recent legal review activity
            </div>
          ) : (
            <ol className="min-h-0 flex-1 space-y-0 overflow-y-auto px-5 py-3">
              {recentActivities.map((doc, idx, arr) => (
                <li key={doc.sq_name} className="relative flex gap-3 pb-4">
                  {idx < arr.length - 1 ? (
                    <span
                      className="absolute bottom-0 left-[15px] top-8 w-px bg-[#E2E8F0]"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">
                    {doc.review_status === "Approved" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : doc.review_status === "Rejected" ? (
                      <XCircle className="h-4 w-4 text-rose-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-600" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/legal/review/${encodeURIComponent(doc.sq_name)}`}
                        className="text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                      >
                        {doc.rfq_name || doc.sq_name}
                      </Link>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          doc.review_status === "Approved"
                            ? "bg-emerald-50 text-emerald-700"
                            : doc.review_status === "Rejected"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {doc.review_status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[#64748B]">
                      {doc.supplier} · {doc.approved_by || "Legal Manager"} ·{" "}
                      {doc.approved_on ? formatDate(doc.approved_on) : "Recent"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* LEGAL RISK OVERVIEW (EXECUTIVE SUMMARY)                        */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold tracking-tight text-slate-900">
              Legal Risk Overview & Compliance Health
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Real-time compliance status across suppliers and contracts
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              High Risk / Legal Holds
            </span>
            <div className="mt-1 text-lg font-bold text-rose-700">
              {kpis.legalHolds}
            </div>
            <span className="text-[11px] text-slate-400">Requires resolution</span>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Pending Verification
            </span>
            <div className="mt-1 text-lg font-bold text-amber-700">
              {kpis.pendingDocsCount}
            </div>
            <span className="text-[11px] text-slate-400">Documents in queue</span>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Upcoming Expirations
            </span>
            <div className="mt-1 text-lg font-bold text-sky-700">
              {kpis.expiringCount}
            </div>
            <span className="text-[11px] text-slate-400">Within 30 days</span>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Approved Compliance Rate
            </span>
            <div className="mt-1 text-lg font-bold text-emerald-700">
              {legalDocs.length > 0
                ? `${((kpis.approvedReviews / legalDocs.length) * 100).toFixed(1)}%`
                : "100%"}
            </div>
            <span className="text-[11px] text-slate-400">Passed review</span>
          </div>
        </div>
      </div>
    </div>
  );
}
