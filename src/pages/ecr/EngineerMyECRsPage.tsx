import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, ClipboardList, Filter, Plus, RefreshCw, Search } from "lucide-react";
import { fetchECRList } from "../../api/ecr";
import { formatECRNumber, getECRHighLevelStatus, isEcrOwnedBy } from "../../config/ecrRoles";
import { getECRCurrentStage, getECRListActionLabel, getECRListActionRoute } from "../../config/ecrQueues";
import { useAuthStore } from "../../store/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import { ECR_TYPES, matchesVisibleQueueFilter } from "./ecrListPresentation";
import { ENGINEER_MY_ECR_TABS, engineerMyECRTab, filterEngineerMyECRs } from "./engineerMyEcrList";
import "../../components/ecr/dashboards/EngineerECRWorkspace.css";

const FILTER_KEYS = ["status", "priority", "department", "supplier", "type", "target-date"];

export default function EngineerMyECRsPage() {
  const user = useAuthStore((state) => state.user);
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(FILTER_KEYS.some((key) => Boolean(params.get(key))));
  const search = params.get("q") || "";
  const debouncedSearch = useDebounce(search, 300);
  const activeTab = engineerMyECRTab(params.get("filter") || "all");
  const query = useQuery({
    queryKey: ["ecr-list", "engineer", user?.email || user?.name],
    queryFn: () => fetchECRList({ limit: 300, owner: user?.email || user?.name }),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const ecrs = useMemo(() => (query.data ?? []).filter((ecr) => isEcrOwnedBy(ecr, user)), [query.data, user]);
  const rows = filterEngineerMyECRs(ecrs, params, user, search ? debouncedSearch : "");
  const departments = [...new Set(ecrs.map((ecr) => ecr.requesting_department).filter(Boolean))].sort();
  const statuses = [...new Set(ecrs.map((ecr) => getECRHighLevelStatus(ecr.select_pxfp, ecr)))].sort();
  const filterCount = FILTER_KEYS.filter((key) => params.get(key) && params.get(key) !== "all").length;
  const hasFilters = Boolean(search || filterCount || activeTab !== "all");
  const unavailable = query.isLoading || query.isError;

  function updateFilter(key: string, value: string, replace = false) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setParams(next, { replace });
  }
  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of [...FILTER_KEYS, "q", "filter"]) next.delete(key);
    setParams(next);
  }

  return (
    <div className="engineer-ecr-workspace engineer-ecr-list-page">
      <header className="engineer-ecr-heading">
        <div><span className="engineer-ecr-eyebrow">Engineering changes</span><h1>My ECRs</h1><p>View and manage engineering change requests created by you.</p></div>
        <div className="engineer-ecr-header-actions">
          <Link to="/ecr/new" className="engineer-ecr-button primary"><Plus size={16} aria-hidden="true" />New ECR</Link>
          <button type="button" className="engineer-ecr-button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "animate-spin" : ""} />Refresh</button>
        </div>
      </header>
      {query.isError && <div role="alert" className="engineer-ecr-error"><AlertCircle size={18} /><span>{query.error instanceof Error ? query.error.message : "Unable to load your ECRs."}</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div>}
      <section className="engineer-ecr-panel engineer-ecr-queue" aria-label="My ECR queue">
        <nav className="engineer-ecr-tabs" aria-label="My ECR status queues">
          {ENGINEER_MY_ECR_TABS.map(({ label, value }) => (
            <button key={value} type="button" aria-current={activeTab === value ? "page" : undefined} onClick={() => updateFilter("filter", value)}>
              {label}<span>{unavailable ? "—" : ecrs.filter((ecr) => matchesVisibleQueueFilter(value, "engineer", ecr, user)).length}</span>
            </button>
          ))}
        </nav>
        <div className="engineer-ecr-filter-area">
          <div className="engineer-ecr-filter-bar">
            <label className="engineer-ecr-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search ECRs</span><input type="search" placeholder="Search ECR, title, department..." value={search} onChange={(event) => updateFilter("q", event.target.value, true)} /></label>
            <button type="button" className="engineer-ecr-button" aria-expanded={filtersOpen} aria-controls="engineer-list-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={15} aria-hidden="true" />Filters{filterCount > 0 ? ` (${filterCount})` : ""}</button>
            {hasFilters && <button type="button" className="engineer-ecr-clear" onClick={clearFilters}>Clear Filters</button>}
          </div>
          {filtersOpen && <div id="engineer-list-filters" className="engineer-ecr-filters">
            <label htmlFor="my-ecr-status">Status<select id="my-ecr-status" value={params.get("status") || "all"} onChange={(event) => updateFilter("status", event.target.value)}><option value="all">All Statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label htmlFor="my-ecr-priority">Priority<select id="my-ecr-priority" value={params.get("priority") || "all"} onChange={(event) => updateFilter("priority", event.target.value)}><option value="all">All Priorities</option>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label htmlFor="my-ecr-department">Department<select id="my-ecr-department" value={params.get("department") || "all"} onChange={(event) => updateFilter("department", event.target.value)}><option value="all">All Departments</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label htmlFor="my-ecr-supplier">Supplier Required<select id="my-ecr-supplier" value={params.get("supplier") || "all"} onChange={(event) => updateFilter("supplier", event.target.value)}><option value="all">All</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label htmlFor="my-ecr-type">ECR Type<select id="my-ecr-type" value={params.get("type") || "all"} onChange={(event) => updateFilter("type", event.target.value)}><option value="all">All Types</option>{ECR_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label htmlFor="my-ecr-date">Target Date<input id="my-ecr-date" type="date" value={params.get("target-date") || ""} onChange={(event) => updateFilter("target-date", event.target.value)} /></label>
          </div>}
        </div>
        <div className="engineer-ecr-table-scroll" tabIndex={0} role="region" aria-label="My ECRs table">
          <table className={unavailable || !rows.length ? "engineer-ecr-table-empty" : undefined}>
            <thead><tr>{["ECR #", "Title", "Department", "Type", "Priority", "Current Stage", "Target Date", "Approval Status", "Action"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>
              {query.isLoading ? <tr><td colSpan={9} className="engineer-ecr-empty" role="status">Loading your ECRs…</td></tr> : query.isError ? <tr><td colSpan={9} className="engineer-ecr-empty">Your ECRs are unavailable. Retry loading above.</td></tr> : !rows.length ? <tr><td colSpan={9} className="engineer-ecr-empty"><ClipboardList size={22} aria-hidden="true" /><strong>{hasFilters ? "No ECRs match this queue or your filters." : "No ECRs yet."}</strong><p>{hasFilters ? "Try another queue or clear your filters." : "Create your first engineering change request to get started."}</p></td></tr> : rows.map((ecr) => (
                <tr key={ecr.name}>
                  <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
                  <td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td>
                  <td>{ecr.requesting_department || "—"}</td><td>{ecr.ecr_type || "—"}</td>
                  <td><ECRPriorityBadge priority={ecr.priority} /></td>
                  <td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td>
                  <td>{ecr.target_implementation_date || "—"}</td>
                  <td><ECRStatusBadge status={ecr.select_pxfp} ecr={ecr} isHighLevel /></td>
                  <td><Link className="engineer-ecr-row-action" to={getECRListActionRoute("engineer", ecr, user)}>{getECRListActionLabel("engineer", ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!unavailable && <footer className="engineer-ecr-table-footer"><span>Showing <strong>{rows.length}</strong> of <strong>{ecrs.length}</strong> requests</span><span>{hasFilters ? "Filtered view" : "All your ECRs"}</span></footer>}
      </section>
    </div>
  );
}
