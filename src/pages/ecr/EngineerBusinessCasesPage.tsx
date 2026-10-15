import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, ClipboardList, RefreshCw, Search } from "lucide-react";
import { fetchECRList } from "../../api/ecr";
import { fetchECRBusinessCase } from "../../api/ecrBusinessCase";
import { formatECRNumber } from "../../config/ecrRoles";
import { getECRCurrentStage, getECRListActionLabel, getECRListActionRoute, matchesECRQueueFilter } from "../../config/ecrQueues";
import { useAuthStore } from "../../store/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import { EMPTY_BUSINESS_CASE_FILTERS, loadEngineerBusinessCaseQueue, matchesBusinessCaseFilters, type BusinessCaseQueueFilters } from "./engineerBusinessCaseQueue";
import "../../components/ecr/dashboards/EngineerECRWorkspace.css";

const CASE_STATUSES = ["Draft", "Finance Review", "Procurement BC Review", "Quality Review", "Approved", "Sent Back", "Rejected", "Ready to prepare"];

export default function EngineerBusinessCasesPage({ role = "engineer" }: { role?: "engineer" | "engineering" }) {
  const user = useAuthStore((state) => state.user);
  const owner = role === "engineer" ? user?.email || user?.name : undefined;
  const [searchParams] = useSearchParams();
  const routeFilter = searchParams.get("filter")?.trim().toLowerCase().replaceAll("_", "-");
  const queueFilter = routeFilter === "business-case-preparation" || routeFilter === "business-case-approved" ? routeFilter : null;
  const [filters, setFilters] = useState<BusinessCaseQueueFilters>(EMPTY_BUSINESS_CASE_FILTERS);
  const search = useDebounce(filters.search, 300);
  const query = useQuery({
    queryKey: ["ecr-list", `${role}-business-cases`, owner ?? "all"],
    queryFn: async () => loadEngineerBusinessCaseQueue(await fetchECRList({ limit: 300, owner }), user, fetchECRBusinessCase, role),
    enabled: Boolean(user) && user?.role === role && (role === "engineering" || Boolean(owner)),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const cases = (query.data?.cases ?? []).filter(({ ecr }) => !queueFilter || matchesECRQueueFilter(queueFilter, role, ecr, user));
  const readyToPrepare = (query.data?.readyToPrepare ?? []).filter((ecr) => !queueFilter || matchesECRQueueFilter(queueFilter, role, ecr, user));
  const ecrs = [...cases.map(({ ecr }) => ecr), ...readyToPrepare];
  const departments = [...new Set(ecrs.map((ecr) => ecr.requesting_department).filter(Boolean))].sort();
  const visibleCases = cases.filter(({ ecr, businessCase }) => matchesBusinessCaseFilters(ecr, businessCase, { ...filters, search }));
  const visibleReady = readyToPrepare.filter((ecr) => matchesBusinessCaseFilters(ecr, null, { ...filters, search }));
  const hasFilters = Object.keys(filters).some((key) => filters[key as keyof BusinessCaseQueueFilters] !== EMPTY_BUSINESS_CASE_FILTERS[key as keyof BusinessCaseQueueFilters]);
  function updateFilter(key: keyof BusinessCaseQueueFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }

  return <div className="engineer-ecr-workspace">
    <header className="engineer-ecr-heading">
      <div><span className="engineer-ecr-eyebrow">Engineering workspace</span><h1>Business Cases</h1><p>{role === "engineering" ? "View business cases linked to engineering change requests." : "Prepare and manage business cases for technically approved ECRs."}</p></div>
      <button type="button" className="engineer-ecr-button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>
    </header>
    {query.isError && <div role="alert" className="engineer-ecr-error"><AlertCircle size={18} aria-hidden="true" /><span>{query.error instanceof Error ? query.error.message : "Unable to load Business Cases."}</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div>}
    <section className="engineer-ecr-panel engineer-ecr-queue" aria-label="Business Case queue" aria-busy={query.isLoading}>
      {queueFilter && <div className="engineer-ecr-panel-heading"><h2>{queueFilter === "business-case-preparation" ? "Business Case Preparation" : "Approved Business Cases"}</h2><Link className="engineer-ecr-text-link" to="/ecr?filter=business-case">View all Business Cases<ArrowRight size={14} aria-hidden="true" /></Link></div>}
      <div className="engineer-ecr-filter-area">
        <div className="engineer-ecr-filter-bar">
          <label className="engineer-ecr-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search Business Case</span><input type="search" placeholder="Search Business Case..." value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} /></label>
          {hasFilters && <button type="button" className="engineer-ecr-clear" onClick={() => setFilters(EMPTY_BUSINESS_CASE_FILTERS)}>Clear Filters</button>}
        </div>
        <div className="engineer-ecr-filters">
          <label>Status<select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="all">All Statuses</option>{CASE_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Department<select value={filters.department} onChange={(event) => updateFilter("department", event.target.value)}><option value="all">All Departments</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Priority<select value={filters.priority} onChange={(event) => updateFilter("priority", event.target.value)}><option value="all">All Priorities</option>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>ECR<select value={filters.ecr} onChange={(event) => updateFilter("ecr", event.target.value)}><option value="all">All ECRs</option>{ecrs.map((ecr) => <option key={ecr.name} value={ecr.name}>{formatECRNumber(ecr)}</option>)}</select></label>
          <label>Target Date<input type="date" value={filters.targetDate} onChange={(event) => updateFilter("targetDate", event.target.value)} /></label>
        </div>
      </div>
      <div className="engineer-ecr-table-scroll" role="region" aria-label="Business Cases table" tabIndex={0}>
        <table className={query.isLoading || query.isError || visibleCases.length === 0 ? "engineer-ecr-table-empty" : undefined}><thead><tr>{["Business Case #", "ECR #", "Title", "Department", "Status", "Priority", "Target Date", "Current Stage", "Action"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>
          {query.isLoading ? <tr><td colSpan={9} className="engineer-ecr-empty" role="status">Loading Business Cases…</td></tr> : query.isError ? <tr><td colSpan={9} className="engineer-ecr-empty">Business Cases are unavailable. Retry loading above.</td></tr> : visibleCases.length === 0 ? <tr><td colSpan={9} className="engineer-ecr-empty"><ClipboardList size={22} aria-hidden="true" /><strong>{hasFilters || queueFilter ? "No Business Cases match this queue or your filters." : "No Business Cases yet."}</strong><p>{hasFilters || queueFilter ? "Try another queue, search or clear your filters." : role === "engineering" ? "Saved business cases linked to ECRs will appear here." : "Saved business cases for your ECRs will appear here."}</p></td></tr> : visibleCases.map(({ ecr, businessCase }) => <tr key={businessCase.name}>
            <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}/business-case`}>{businessCase.business_case_id || businessCase.name}</Link></td>
            <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
            <td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td><td>{ecr.requesting_department || "—"}</td><td><ECRStatusBadge status={businessCase.status} /></td><td><ECRPriorityBadge priority={ecr.priority} /></td><td>{ecr.target_implementation_date || "—"}</td><td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td>
            <td><Link className="engineer-ecr-row-action" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}/business-case`}>{getECRListActionLabel(role, ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
          </tr>)}
        </tbody></table>
      </div>
      {!query.isLoading && !query.isError && <div className="engineer-ecr-table-footer"><span>Showing <strong>{visibleCases.length}</strong> of <strong>{cases.length}</strong> business cases</span><span>{hasFilters ? "Filtered view" : role === "engineering" ? "ECR Business Cases" : "Your Business Cases"}</span></div>}
    </section>
    {!query.isLoading && !query.isError && visibleReady.length > 0 && <section className="engineer-ecr-panel engineer-ecr-queue" aria-labelledby="business-case-ready-heading">
      <div className="engineer-ecr-panel-heading"><div><h2 id="business-case-ready-heading">Ready to prepare</h2><p>Technically approved ECRs awaiting their first business case.</p></div></div>
      <div className="engineer-ecr-table-scroll" role="region" aria-label="ECRs ready for Business Case preparation" tabIndex={0}>
        <table><thead><tr>{["ECR #", "Title", "Department", "Priority", "Target Date", "Action"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{visibleReady.map((ecr) => <tr key={ecr.name}>
          <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td><td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td><td>{ecr.requesting_department || "—"}</td><td><ECRPriorityBadge priority={ecr.priority} /></td><td>{ecr.target_implementation_date || "—"}</td><td><Link className="engineer-ecr-row-action" to={getECRListActionRoute(role, ecr, user)}>{getECRListActionLabel(role, ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
        </tr>)}</tbody></table>
      </div>
    </section>}
  </div>;
}
