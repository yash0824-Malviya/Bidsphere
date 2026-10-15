import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, ClipboardList, Filter, Plus, RefreshCw, Search } from "lucide-react";
import { fetchECRList } from "../../../api/ecr";
import { formatECRNumber, isEcrOwnedBy } from "../../../config/ecrRoles";
import { getECRAssignedTo, getECRCurrentStage, getECRListActionLabel, getECRListActionRoute } from "../../../config/ecrQueues";
import { useAuthStore } from "../../../store/authStore";
import { useDebounce } from "../../../hooks/useDebounce";
import { ECR_TYPES, activeQueueValue, matchesVisibleQueueFilter, queueFiltersForRole } from "../../../pages/ecr/ecrListPresentation";
import ECRPriorityBadge from "../ECRPriorityBadge";
import ECRStatusBadge from "../ECRStatusBadge";
import { getRoleDashboardQueue } from "./RoleECRDashboard";
import EngineerRecentActivity from "./EngineerRecentActivity";
import "./EngineerECRWorkspace.css";

import { engineerECRMetrics } from "./engineerEcrPresentation";

const ACTIONS = [
  { index: 2, title: "Pending Approval", description: "ECRs currently waiting for your review.", action: "Review ECRs" },
  { index: 3, title: "Sent Back", description: "Returned requests requiring your revision.", action: "View Revisions" },
  { index: 1, title: "Business Cases to Prepare", description: "Technically approved changes ready for a business case.", action: "Prepare Business Cases" },
  { index: 4, title: "Approved ECRs", description: "Approved changes ready for downstream work.", action: "View Approved ECRs" },
];

export default function EngineerECRWorkspace({ dashboard = false }: { dashboard?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeFilter = searchParams.get("filter") || "all";
  const activeQueue = activeQueueValue(routeFilter, "engineer");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priority, setPriority] = useState("all");
  const [department, setDepartment] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [type, setType] = useState("all");
  const [targetDate, setTargetDate] = useState("");
  const query = useQuery({
    queryKey: [dashboard ? "ecr-dashboard" : "ecr-list", "engineer", user?.email || user?.name],
    queryFn: () => fetchECRList({ limit: 300, owner: user?.email || user?.name }),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const ecrs = useMemo(() => (query.data ?? []).filter((ecr) => isEcrOwnedBy(ecr, user)), [query.data, user]);
  const metrics = useMemo(() => engineerECRMetrics(ecrs, user), [ecrs, user]);
  const queues = queueFiltersForRole("engineer");
  const queueCounts = Object.fromEntries(queues.map(({ value }) => [value, ecrs.filter((ecr) => matchesVisibleQueueFilter(value, "engineer", ecr, user)).length]));
  const departments = [...new Set(ecrs.map((ecr) => ecr.requesting_department).filter(Boolean))].sort();
  const filtersCount = [priority, department, supplier, type].filter((value) => value !== "all").length + (targetDate ? 1 : 0);
  const hasFilters = Boolean(search || filtersCount || (!dashboard && activeQueue !== "all"));
  const rows = (() => {
    // Retain the dashboard's action queue and the list page's existing queue predicates.
    const scoped = dashboard ? getRoleDashboardQueue("engineer", ecrs, user) : ecrs;
    const term = debouncedSearch.trim().toLowerCase();
    return scoped.filter((ecr) => {
      if (!dashboard && !matchesVisibleQueueFilter(routeFilter, "engineer", ecr, user)) return false;
      if (priority !== "all" && ecr.priority !== priority) return false;
      if (department !== "all" && ecr.requesting_department !== department) return false;
      if (supplier !== "all" && ecr.supplier_response_required !== supplier) return false;
      if (type !== "all" && ecr.ecr_type !== type) return false;
      if (targetDate && ecr.target_implementation_date !== targetDate) return false;
      return !term || [ecr.name, ecr.ecr_number, formatECRNumber(ecr), ecr.ecr_title, ecr.requesting_department, ecr.program, ecr.ecr_owner, ecr.owner, getECRCurrentStage(ecr.select_pxfp, ecr), getECRAssignedTo(ecr)].some((value) => String(value || "").toLowerCase().includes(term));
    });
  })();
  const stages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ecr of ecrs) {
      const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [ecrs]);
  function clearFilters() {
    setSearch(""); setPriority("all"); setDepartment("all"); setSupplier("all"); setType("all"); setTargetDate("");
    const next = new URLSearchParams(searchParams); next.delete("filter"); setSearchParams(next);
  }
  function refresh() {
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["engineer-ecr-activity"] });
  }
  const loading = query.isLoading;
  const unavailable = loading || query.isError;
  return (
    <div className="engineer-ecr-workspace">
      <header className="engineer-ecr-heading">
        <div><span className="engineer-ecr-eyebrow">Engineering workspace</span><h1>Engineering Change Requests</h1><p>Create, track and manage your engineering change requests.</p></div>
        <div className="engineer-ecr-header-actions">
          <Link to="/ecr/new" className="engineer-ecr-button primary"><Plus size={16} aria-hidden="true" />New ECR</Link>
          <button type="button" className="engineer-ecr-button" onClick={refresh} disabled={query.isFetching}><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>
        </div>
      </header>

      {query.isError && <div role="alert" className="engineer-ecr-error"><AlertCircle size={18} /><span>{query.error instanceof Error ? query.error.message : "Unable to load Engineering Change Requests."}</span><button type="button" onClick={refresh}>Retry</button></div>}

      <section aria-label="ECR summary" aria-busy={loading} className="engineer-ecr-kpis">
        {metrics.map(({ label, value, hint, icon: Icon, filter, tone }) => <Link key={filter} to={`/ecr?filter=${filter}`} className="engineer-ecr-kpi">
          <div className="engineer-ecr-kpi-top"><span>{label}</span><span className={`engineer-ecr-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span></div>
          <strong className="engineer-ecr-number">{unavailable ? "—" : value}</strong><p>{hint}</p>
        </Link>)}
      </section>

      <section aria-labelledby="engineer-action-heading">
        <div className="engineer-ecr-section-heading"><div><h2 id="engineer-action-heading">Engineering Action Center</h2><p>ECRs and downstream activities requiring your attention.</p></div></div>
        <div className="engineer-ecr-actions">
          {ACTIONS.map(({ index, title, description, action }) => { const metric = metrics[index]; const Icon = metric.icon; return <article key={title} className="engineer-ecr-action-card">
            <div className="engineer-ecr-action-top"><span className={`engineer-ecr-icon ${metric.tone}`}><Icon size={18} aria-hidden="true" /></span><strong>{unavailable ? "—" : metric.value}</strong></div>
            <h3>{title}</h3><p>{description}</p><Link to={`/ecr?filter=${metric.filter}`}>{action}<ArrowRight size={14} aria-hidden="true" /></Link>
          </article>; })}
        </div>
      </section>

      <section className="engineer-ecr-panel engineer-ecr-queue" aria-labelledby="engineer-queue-heading">
        <div className="engineer-ecr-panel-heading"><div><h2 id="engineer-queue-heading">My ECRs</h2><p>{dashboard ? "Requests requiring your action. View the queue for all your ECRs." : "Your engineering changes, current stages and next actions."}</p></div><Link to="/ecr?filter=mine" className="engineer-ecr-text-link">View Queue<ArrowRight size={14} aria-hidden="true" /></Link></div>
        <nav className="engineer-ecr-tabs" aria-label="ECR queues">
          {queues.map(({ label, value }) => {
            const content = <>{label}<span>{unavailable ? "—" : queueCounts[value]}</span></>;
            return dashboard ? <Link key={value} to={value === "all" ? "/ecr" : `/ecr?filter=${value}`}>{content}</Link> : <button key={value} type="button" aria-current={activeQueue === value ? "page" : undefined} onClick={() => { const next = new URLSearchParams(searchParams); if (value === "all") next.delete("filter"); else next.set("filter", value); setSearchParams(next); }}>{content}</button>;
          })}
        </nav>
        <div className="engineer-ecr-filter-area">
          <div className="engineer-ecr-filter-bar"><label className="engineer-ecr-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search ECRs</span><input type="search" placeholder="Search ECR, title, department..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><button type="button" className="engineer-ecr-button" aria-expanded={filtersOpen} aria-controls="engineer-ecr-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={15} aria-hidden="true" />Filters{filtersCount > 0 ? ` (${filtersCount})` : ""}</button>{hasFilters && <button type="button" className="engineer-ecr-clear" onClick={clearFilters}>Clear Filters</button>}</div>
          {filtersOpen && <div id="engineer-ecr-filters" className="engineer-ecr-filters">
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All Priorities</option>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All Departments</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Supplier Required<select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="all">All</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label>ECR Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All Types</option>{ECR_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Target Date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
          </div>}
          {!dashboard && !queues.some(({ value }) => value === activeQueue) && <p className="engineer-ecr-active-filter">Queue: {activeQueue.replaceAll("-", " ")}</p>}
        </div>
        <div className="engineer-ecr-table-scroll" tabIndex={0} role="region" aria-label="Engineering Change Requests table">
          <table className={unavailable || rows.length === 0 ? "engineer-ecr-table-empty" : undefined}><thead><tr>{["ECR #", "Title", "Type", "Priority", "Current Stage", "Assigned To", "Target Date", "Action"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>
            {loading ? <tr><td colSpan={8} className="engineer-ecr-empty" role="status">Loading your engineering changes…</td></tr> : query.isError ? <tr><td colSpan={8} className="engineer-ecr-empty">Requests are unavailable. Retry loading above.</td></tr> : rows.length === 0 ? <tr><td colSpan={8} className="engineer-ecr-empty"><ClipboardList size={22} aria-hidden="true" /><strong>{hasFilters ? "No ECRs match this queue or your filters." : dashboard ? "No ECRs requiring your action." : "No ECRs yet."}</strong><p>{hasFilters ? "Try another queue or clear your filters." : dashboard ? "You're all caught up." : "Create your first engineering change request to get started."}</p></td></tr> : rows.map((ecr) => <tr key={ecr.name}>
              <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
              <td className="engineer-ecr-title-cell"><span title={ecr.ecr_title}>{ecr.ecr_title}</span></td><td>{ecr.ecr_type || "—"}</td><td><ECRPriorityBadge priority={ecr.priority} /></td><td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td><td className="engineer-ecr-assignee"><span title={getECRAssignedTo(ecr)}>{getECRAssignedTo(ecr)}</span></td><td>{ecr.target_implementation_date || "—"}</td><td><Link className="engineer-ecr-row-action" to={getECRListActionRoute("engineer", ecr, user)}>{getECRListActionLabel("engineer", ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
            </tr>)}
          </tbody></table>
        </div>
        {!unavailable && <div className="engineer-ecr-table-footer"><span>Showing <strong>{rows.length}</strong> of <strong>{ecrs.length}</strong> requests</span><span>{dashboard ? "Your action queue" : hasFilters ? "Filtered view" : "All your ECRs"}</span></div>}
      </section>

      <section className="engineer-ecr-panel" aria-labelledby="engineer-status-heading"><div className="engineer-ecr-panel-heading"><div><h2 id="engineer-status-heading">ECR Status Overview</h2><p>Current workflow stages across your requests.</p></div></div><div className="engineer-ecr-statuses">{unavailable ? <p>{loading ? "Loading statuses…" : "Status overview unavailable."}</p> : stages.length ? stages.map(([stage, count]) => <div key={stage}><ECRStatusBadge status={stage} /><strong>{count}</strong></div>) : <p>No ECR statuses to display.</p>}</div></section>
      {!query.isError && <EngineerRecentActivity ecrs={ecrs} loading={loading} />}
    </div>
  );
}
