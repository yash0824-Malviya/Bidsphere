import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, ClipboardList, RefreshCw, Search } from "lucide-react";
import { fetchECRList } from "../../api/ecr";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import { formatECRNumber } from "../../config/ecrRoles";
import {
  getECRCurrentStage,
  getECRListActionLabel,
  getECRListActionRoute,
} from "../../config/ecrQueues";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuthStore } from "../../store/authStore";
import { ECR_TYPES } from "./ecrListPresentation";
import { isEngineerTechnicalReviewAssignment } from "./engineerTechnicalReviewPresentation";
import "../../components/ecr/dashboards/EngineerECRWorkspace.css";

const COLUMNS = ["ECR #", "Title", "Priority", "Department", "Supplier Required", "Target Date", "Current Stage", "Action"];

export default function EngineerTechnicalReviewPage() {
  const user = useAuthStore((state) => state.user);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [priority, setPriority] = useState("all");
  const [department, setDepartment] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [type, setType] = useState("all");
  const [targetDate, setTargetDate] = useState("");
  const query = useQuery({
    queryKey: ["ecr-list", "engineer", user?.email || user?.name],
    queryFn: () => fetchECRList({ limit: 300, owner: user?.email || user?.name }),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const assignedEcrs = useMemo(() => (query.data ?? []).filter((ecr) =>
    isEngineerTechnicalReviewAssignment(ecr, user),
  ), [query.data, user]);
  const departments = [...new Set(assignedEcrs.map((ecr) => ecr.requesting_department).filter(Boolean))].sort();
  const hasFilters = Boolean(search || targetDate || [priority, department, supplier, type].some((value) => value !== "all"));
  const term = debouncedSearch.trim().toLowerCase();
  const rows = assignedEcrs.filter((ecr) => {
    if (priority !== "all" && ecr.priority !== priority) return false;
    if (department !== "all" && ecr.requesting_department !== department) return false;
    if (supplier !== "all" && ecr.supplier_response_required !== supplier) return false;
    if (type !== "all" && ecr.ecr_type !== type) return false;
    if (targetDate && ecr.target_implementation_date?.slice(0, 10) !== targetDate) return false;
    return !term || [formatECRNumber(ecr), ecr.ecr_title, ecr.requesting_department]
      .some((value) => String(value || "").toLowerCase().includes(term));
  });

  function clearFilters() {
    setSearch("");
    setPriority("all");
    setDepartment("all");
    setSupplier("all");
    setType("all");
    setTargetDate("");
  }

  return (
    <div className="engineer-ecr-workspace engineer-ecr-list-page">
      <header className="engineer-ecr-heading">
        <div>
          <span className="engineer-ecr-eyebrow">Engineering workspace</span>
          <h1>Technical Review</h1>
          <p>Review engineering change requests currently assigned to you.</p>
        </div>
        <button type="button" className="engineer-ecr-button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} aria-hidden="true" />Refresh
        </button>
      </header>

      {query.isError && <div role="alert" className="engineer-ecr-error">
        <AlertCircle size={18} aria-hidden="true" />
        <span>{query.error instanceof Error ? query.error.message : "Unable to load Technical Review requests."}</span>
        <button type="button" onClick={() => void query.refetch()}>Retry</button>
      </div>}

      <section className="engineer-ecr-panel engineer-ecr-queue" aria-labelledby="engineer-technical-review-heading">
        <div className="engineer-ecr-panel-heading">
          <div><h2 id="engineer-technical-review-heading">Technical Review Queue</h2><p>ECRs awaiting your technical review.</p></div>
        </div>
        <div className="engineer-ecr-filter-area">
          <div className="engineer-ecr-filter-bar">
            <label className="engineer-ecr-search">
              <Search size={16} aria-hidden="true" /><span className="sr-only">Search Technical Review ECRs</span>
              <input type="search" placeholder="Search ECR, title, department..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {hasFilters && <button type="button" className="engineer-ecr-clear" onClick={clearFilters}>Clear Filters</button>}
          </div>
          <div className="engineer-ecr-filters" role="group" aria-label="Technical Review filters">
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All Priorities</option>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All Departments</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Supplier Required<select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="all">All</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label>ECR Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All Types</option>{ECR_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Target Date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
          </div>
        </div>
        <div className="engineer-ecr-table-scroll" tabIndex={0} role="region" aria-label="Technical Review queue table">
          <table aria-busy={query.isLoading}>
            <thead><tr>{COLUMNS.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>
              {query.isLoading ? <tr><td colSpan={COLUMNS.length} className="engineer-ecr-empty" role="status">Loading Technical Review requests…</td></tr>
                : query.isError ? <tr><td colSpan={COLUMNS.length} className="engineer-ecr-empty">Requests are unavailable. Retry loading above.</td></tr>
                  : rows.length === 0 ? <tr><td colSpan={COLUMNS.length} className="engineer-ecr-empty">
                    <ClipboardList size={22} aria-hidden="true" />
                    <strong>{hasFilters ? "No Technical Review requests match your filters." : "No ECRs are currently assigned to you for technical review."}</strong>
                    <p>{hasFilters ? "Clear your filters to see all assigned requests." : "Requests will appear here when assigned to you for technical review."}</p>
                  </td></tr>
                    : rows.map((ecr) => <tr key={ecr.name}>
                      <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
                      <td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td>
                      <td><ECRPriorityBadge priority={ecr.priority} /></td>
                      <td>{ecr.requesting_department || "—"}</td>
                      <td>{ecr.supplier_response_required || "—"}</td>
                      <td>{ecr.target_implementation_date || "—"}</td>
                      <td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td>
                      <td><Link className="engineer-ecr-row-action" to={getECRListActionRoute("engineer", ecr, user)}>{getECRListActionLabel("engineer", ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
                    </tr>)}
            </tbody>
          </table>
        </div>
        {!query.isLoading && !query.isError && <div className="engineer-ecr-table-footer"><span>Showing <strong>{rows.length}</strong> of <strong>{assignedEcrs.length}</strong> requests</span><span>Your technical review queue</span></div>}
      </section>
    </div>
  );
}
