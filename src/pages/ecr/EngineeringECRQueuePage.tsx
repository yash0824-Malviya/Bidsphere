import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, ClipboardList, RefreshCw, Search } from "lucide-react";
import { engineeringECRQueryOptions } from "../../utils/engineeringECRQuery";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import { formatECRNumber } from "../../config/ecrRoles";
import { getECRCurrentStage, getECRListActionLabel, getECRListActionRoute } from "../../config/ecrQueues";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuthStore } from "../../store/authStore";
import { ECR_TYPES, activeQueueValue, matchesVisibleQueueFilter, queueFiltersForRole } from "./ecrListPresentation";
import { ENGINEERING_LIST_FILTER_KEYS, filterEngineeringECRRows, getEngineeringECRApprovedOn } from "./engineeringEcrListPresentation";
import { getEngineeringECRMetrics } from "./engineeringEcrMetrics";
import "../../components/ecr/dashboards/EngineerECRWorkspace.css";

/** List presentation shared by two distinct pages; no dashboard panels or workflow mutations. */
export default function EngineeringECRQueuePage({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const [params, setParams] = useSearchParams();
  const search = params.get("q") || "";
  const debouncedSearch = useDebounce(search, 300);
  const routeFilter = params.get("filter") || "all";
  const activeTab = routeFilter === "completed" ? "closed" : activeQueueValue(routeFilter, "engineering");
  const tabs = queueFiltersForRole("engineering");
  const query = useQuery(engineeringECRQueryOptions());
  const records = useMemo(() => query.data ?? [], [query.data]);
  const metrics = useMemo(() => getEngineeringECRMetrics(records, user), [records, user]);
  const tabCounts: Record<string, number> = {
    all: metrics.all, mine: metrics.mine, "pending-approval": metrics.pending,
    "sent-back": metrics.sentBack, approved: metrics.approved, closed: metrics.closed,
  };
  const queue = useMemo(() => records.filter((ecr) => matchesVisibleQueueFilter(reviewOnly ? "pending-approval" : routeFilter, "engineering", ecr, user)),
  [records, reviewOnly, routeFilter, user]);
  const rows = filterEngineeringECRRows(queue, params, search ? debouncedSearch : "");
  const filterSource = reviewOnly ? queue : records;
  const departments = [...new Set(filterSource.map((ecr) => ecr.requesting_department).filter(Boolean))].sort();
  const hasFilters = Boolean(search || ENGINEERING_LIST_FILTER_KEYS.some((key) => params.get(key) && params.get(key) !== "all"));
  const unavailable = query.isLoading || query.isError;
  const columns = ["ECR #", "Title", "Department", "Priority", "Supplier Required", "Target Date",
    ...(reviewOnly ? ["Current Stage"] : ["Approval Status", "Approved On"]), "Action"];
  const title = reviewOnly ? "Engineering Review" : "Engineering Change Requests";

  function updateParam(key: string, value: string, replace = false) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setParams(next, { replace });
  }
  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of [...ENGINEERING_LIST_FILTER_KEYS, "q"]) next.delete(key);
    setParams(next);
  }

  return (
    <div className="engineer-ecr-workspace engineering-manager-ecr-list-page">
      <header className="engineer-ecr-heading">
        <div><span className="engineer-ecr-eyebrow">Engineering changes</span><h1>{title}</h1>
          <p>{reviewOnly ? "Review technical feasibility and engineering impact of change requests." : "Create, track and manage your engineering change requests."}</p>
        </div>
        <button type="button" className="engineer-ecr-button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "animate-spin" : ""} />Refresh
        </button>
      </header>
      {query.isError && <div role="alert" className="engineer-ecr-error"><AlertCircle size={18} aria-hidden="true" /><span>{query.error instanceof Error ? query.error.message : "Unable to load engineering change requests."}</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div>}
      <section className="engineer-ecr-panel engineer-ecr-queue" aria-label={reviewOnly ? "Engineering Review Queue" : "All ECRs"}>
        {reviewOnly ? <div className="engineer-ecr-panel-heading"><div><h2>Engineering Review Queue</h2><p>ECRs currently requiring your engineering review.</p></div></div> :
          <nav className="engineer-ecr-tabs" aria-label="ECR queues">
            {tabs.map(({ label, value }) => <button key={value} type="button" aria-current={activeTab === value ? "page" : undefined} onClick={() => updateParam("filter", value)}>
              {label}<span>{unavailable ? "—" : tabCounts[value]}</span>
            </button>)}
          </nav>}
        <div className="engineer-ecr-filter-area">
          <div className="engineer-ecr-filter-bar">
            <label className="engineer-ecr-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search ECRs</span><input type="search" placeholder="Search ECR, title, department..." value={search} onChange={(event) => updateParam("q", event.target.value, true)} /></label>
            {hasFilters && <button type="button" className="engineer-ecr-clear" onClick={clearFilters}>Clear Filters</button>}
          </div>
          <div className="engineer-ecr-filters" role="group" aria-label="ECR filters">
            <label>Priority<select value={params.get("priority") || "all"} onChange={(event) => updateParam("priority", event.target.value)}><option value="all">All Priorities</option>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Department<select value={params.get("department") || "all"} onChange={(event) => updateParam("department", event.target.value)}><option value="all">All Departments</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Supplier Required<select value={params.get("supplier") || "all"} onChange={(event) => updateParam("supplier", event.target.value)}><option value="all">All</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label>ECR Type<select value={params.get("type") || "all"} onChange={(event) => updateParam("type", event.target.value)}><option value="all">All Types</option>{ECR_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Target Date<input type="date" value={params.get("target-date") || ""} onChange={(event) => updateParam("target-date", event.target.value)} /></label>
          </div>
        </div>
        <div className="engineer-ecr-table-scroll" tabIndex={0} role="region" aria-label={reviewOnly ? "Engineering Review table" : "All ECRs table"}>
          <table aria-busy={query.isLoading} className={unavailable || !rows.length ? "engineer-ecr-table-empty" : undefined}>
            <thead><tr>{columns.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>
              {query.isLoading ? <tr><td colSpan={columns.length} className="engineer-ecr-empty" role="status">Loading engineering change requests…</td></tr>
                : query.isError ? <tr><td colSpan={columns.length} className="engineer-ecr-empty">Requests are unavailable. Retry loading above.</td></tr>
                  : !rows.length ? <tr><td colSpan={columns.length} className="engineer-ecr-empty"><ClipboardList size={22} aria-hidden="true" /><strong>{hasFilters ? "No ECRs match your filters." : reviewOnly ? "No ECRs awaiting engineering review" : "No ECRs in this queue"}</strong><p>{hasFilters ? "Clear your filters to see this queue." : reviewOnly ? "Requests appear here when your engineering review is required." : "Change the queue tab to view other engineering change requests."}</p></td></tr>
                    : rows.map((ecr) => <tr key={ecr.name}>
                      <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
                      <td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td>
                      <td>{ecr.requesting_department || "—"}</td>
                      <td><ECRPriorityBadge priority={ecr.priority} /></td>
                      <td>{ecr.supplier_response_required || "—"}</td>
                      <td>{ecr.target_implementation_date?.slice(0, 10) || "—"}</td>
                      <td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td>
                      {!reviewOnly && <td>{getEngineeringECRApprovedOn(ecr)}</td>}
                      <td><Link className="engineer-ecr-row-action" to={getECRListActionRoute("engineering", ecr, user)}>{getECRListActionLabel("engineering", ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
                    </tr>)}
            </tbody>
          </table>
        </div>
        {!unavailable && <footer className="engineer-ecr-table-footer"><span>Showing <strong>{rows.length}</strong> of <strong>{reviewOnly ? queue.length : records.length}</strong> requests</span><span>{reviewOnly ? "Your engineering review queue" : activeTab === "all" && !hasFilters ? "All ECRs" : "Filtered view"}</span></footer>}
      </section>
    </div>
  );
}
