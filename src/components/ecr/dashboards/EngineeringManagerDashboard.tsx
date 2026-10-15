import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, Archive, ArrowRight, CheckCircle2, ClipboardList, Clock3, FileSearch, RefreshCw, RotateCcw } from "lucide-react";
import { engineeringECRQueryOptions } from "../../../utils/engineeringECRQuery";
import { formatECRNumber } from "../../../config/ecrRoles";
import { getECRCurrentStage, getECRListActionLabel, getECRListActionRoute } from "../../../config/ecrQueues";
import { useAuthStore } from "../../../store/authStore";
import ECRPriorityBadge from "../ECRPriorityBadge";
import ECRStatusBadge from "../ECRStatusBadge";
import { engineeringManagerDashboardData } from "./engineeringManagerDashboardPresentation";
import "./EngineerECRWorkspace.css";
import "./EngineeringManagerDashboard.css";

export default function EngineeringManagerDashboard() {
  const user = useAuthStore((state) => state.user);
  const query = useQuery(engineeringECRQueryOptions());
  const { summary, businessCasesToPrepare, recent, relevantCount } = useMemo(
    () => engineeringManagerDashboardData(query.data ?? [], user), [query.data, user],
  );
  const unavailable = query.isLoading || query.isError;
  const metrics = [
    { label: "My ECRs", count: summary.mine, hint: "ECRs created by me", icon: ClipboardList, tone: "blue", to: "/ecr?filter=mine" },
    { label: "Pending Approval", count: summary.pending, hint: "Technical approval required", icon: Clock3, tone: "amber", to: "/ecr?filter=engineering" },
    { label: "Sent Back", count: summary.sentBack, hint: "Returned for revision", icon: RotateCcw, tone: "orange", to: "/ecr?filter=sent-back" },
    { label: "Approved", count: summary.approved, hint: "Ready for downstream work", icon: CheckCircle2, tone: "green", to: "/ecr?filter=approved" },
    { label: "Closed", count: summary.closed, hint: "Completed ECR records", icon: Archive, tone: "gray", to: "/ecr?filter=closed" },
  ];
  const actions = [
    { ...metrics[1], title: "Pending Approval", description: "ECRs currently waiting for your review.", action: "Review ECRs" },
    { ...metrics[2], title: "Sent Back", description: "Returned requests requiring your revision.", action: "View Revisions" },
    { count: businessCasesToPrepare, icon: FileSearch, tone: "purple", to: "/ecr?filter=business-case", title: "Business Cases to Prepare", description: "Technically approved changes ready for a business case.", action: "Prepare Business Cases" },
    { ...metrics[3], title: "Approved ECRs", description: "Approved changes ready for downstream work.", action: "View Approved ECRs" },
  ];

  return <div className="engineer-ecr-workspace engineering-manager-dashboard">
    <header className="engineer-ecr-heading">
      <div><h1>Engineering Manager Dashboard</h1><p>Monitor engineering changes, technical reviews and downstream business-case activities.</p></div>
      <button type="button" className="engineer-ecr-button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "animate-spin" : ""} />Refresh</button>
    </header>

    {query.isError && <div role="alert" className="engineer-ecr-error"><AlertCircle size={18} aria-hidden="true" /><span>{query.error instanceof Error ? query.error.message : "Unable to load dashboard data."}</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div>}

    <section aria-labelledby="engineering-overview-heading" aria-busy={query.isLoading}>
      <div className="engineer-ecr-section-heading"><h2 id="engineering-overview-heading">Engineering Overview</h2></div>
      <div className="engineer-ecr-kpis">
        {metrics.map(({ label, count, hint, icon: Icon, tone, to }) => <Link key={label} to={to} className="engineer-ecr-kpi">
          <div className="engineer-ecr-kpi-top"><span>{label}</span><span className={`engineer-ecr-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span></div>
          <strong className="engineer-ecr-number">{unavailable ? "—" : count}</strong><p>{hint}</p>
        </Link>)}
      </div>
    </section>

    <section aria-labelledby="engineering-manager-actions-heading" aria-busy={query.isLoading}>
      <div className="engineer-ecr-section-heading"><div><h2 id="engineering-manager-actions-heading">Engineering Action Center</h2><p>ECRs and downstream activities requiring your attention.</p></div></div>
      <div className="engineer-ecr-actions">
        {actions.map(({ title, count, description, action, icon: Icon, tone, to }) => <article key={title} className="engineer-ecr-action-card">
          <div className="engineer-ecr-action-top"><span className={`engineer-ecr-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span><strong>{unavailable ? "—" : count}</strong></div>
          <h3>{title}</h3><p>{description}</p><Link to={to}>{action}<ArrowRight size={14} aria-hidden="true" /></Link>
        </article>)}
      </div>
      {!unavailable && summary.pending === 0 && summary.sentBack === 0 && <div className="engineering-manager-caught-up" role="status"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>No engineering actions pending</strong><p>All assigned engineering reviews are up to date.</p></div></div>}
    </section>

    <section className="engineer-ecr-panel engineer-ecr-queue" aria-labelledby="engineering-manager-recent-heading">
      <div className="engineer-ecr-panel-heading"><div><h2 id="engineering-manager-recent-heading">My ECRs</h2><p>Your engineering changes, current stages and next actions.</p></div><Link to="/ecr" className="engineer-ecr-text-link">View Queue<ArrowRight size={14} aria-hidden="true" /></Link></div>
      <div className="engineer-ecr-table-scroll" role="region" aria-label="Recent relevant ECRs" tabIndex={0}>
        <table className={unavailable || !recent.length ? "engineer-ecr-table-empty" : undefined} aria-busy={query.isLoading}>
          <thead><tr>{["ECR #", "Title", "Priority", "Current Stage", "Target Date", "Action"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{unavailable ? <tr><td colSpan={6} className="engineer-ecr-empty" role="status">{query.isLoading ? "Loading engineering changes…" : "Engineering changes are unavailable. Retry above."}</td></tr>
            : !recent.length ? <tr><td colSpan={6} className="engineer-ecr-empty"><strong>No recent ECRs to display</strong><p>Your created requests and assigned or reviewed ECRs will appear here.</p></td></tr>
              : recent.map((ecr) => <tr key={ecr.name}>
                <td><Link className="engineer-ecr-reference" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`}>{formatECRNumber(ecr)}</Link></td>
                <td className="engineer-ecr-title-cell"><span>{ecr.ecr_title}</span></td><td><ECRPriorityBadge priority={ecr.priority} /></td>
                <td><ECRStatusBadge status={getECRCurrentStage(ecr.select_pxfp, ecr)} /></td><td className="engineering-manager-date">{ecr.target_implementation_date?.slice(0, 10) || "—"}</td>
                <td><Link className="engineer-ecr-row-action" to={getECRListActionRoute("engineering", ecr, user)}>{getECRListActionLabel("engineering", ecr, user)}<ArrowRight size={13} aria-hidden="true" /></Link></td>
              </tr>)}</tbody>
        </table>
      </div>
      {!unavailable && recent.length > 0 && <footer className="engineer-ecr-table-footer"><span>Showing {recent.length} of {relevantCount} relevant ECRs</span><span>Most recently updated</span></footer>}
    </section>
  </div>;
}
