import { CheckCircle2, Clock, XCircle, Send, Sparkles, RefreshCw } from "lucide-react";

interface Props {
  status: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function IntakeApprovalBadge({ status, className = "", size = "md" }: Props) {
  let badgeStyle = "bg-neutral-100 text-neutral-700 border-neutral-200";
  let Icon = Clock;
  let label = status;

  switch (status) {
    case "Draft":
      badgeStyle = "bg-slate-100 text-slate-700 border-slate-300";
      Icon = Clock;
      label = "Draft";
      break;
    case "Submitted":
    case "Under Review":
      badgeStyle = "bg-amber-50 text-amber-800 border-amber-300";
      Icon = Send;
      label = "Submitted";
      break;
    case "Pending Finance":
    case "Pending Finance Review":
      badgeStyle = "bg-blue-50 text-blue-800 border-blue-300";
      Icon = Clock;
      label = "Pending Finance";
      break;
    case "Revision Required - Finance":
    case "Revision Required":
      badgeStyle = "bg-amber-100 text-amber-900 border-amber-400";
      Icon = RefreshCw;
      label = "Revision Required (Finance)";
      break;
    case "Pending Legal":
    case "Pending Legal Review":
      badgeStyle = "bg-purple-50 text-purple-800 border-purple-300";
      Icon = Clock;
      label = "Pending Legal";
      break;
    case "Revision Required - Legal":
      badgeStyle = "bg-amber-100 text-amber-900 border-amber-400";
      Icon = RefreshCw;
      label = "Revision Required (Legal)";
      break;
    case "Pending Procurement":
      badgeStyle = "bg-amber-50 text-amber-800 border-amber-300";
      Icon = Clock;
      label = "Pending Procurement";
      break;
    case "Procurement Ready":
      badgeStyle = "bg-emerald-50 text-emerald-800 border-emerald-300";
      Icon = CheckCircle2;
      label = "Procurement Ready";
      break;
    case "Approved":
    case "Approved - Ready for RFQ":
      badgeStyle = "bg-emerald-50 text-emerald-800 border-emerald-300";
      Icon = CheckCircle2;
      label = "Procurement Ready";
      break;
    case "RFQ Created":
      badgeStyle = "bg-indigo-50 text-indigo-800 border-indigo-300";
      Icon = Sparkles;
      label = "RFQ Created";
      break;
    case "Rejected":
      badgeStyle = "bg-red-50 text-red-800 border-red-300";
      Icon = XCircle;
      label = "Rejected";
      break;
    case "Closed":
      badgeStyle = "bg-neutral-100 text-neutral-600 border-neutral-300";
      Icon = CheckCircle2;
      label = "Closed";
      break;
    default:
      if (status.includes("Approved")) {
        badgeStyle = "bg-emerald-50 text-emerald-800 border-emerald-300";
        Icon = CheckCircle2;
      }
  }

  const sizeClasses =
    size === "sm"
      ? "px-2 py-0.5 text-xs gap-1"
      : size === "lg"
      ? "px-3.5 py-1.5 text-sm gap-1.5 font-semibold"
      : "px-2.5 py-1 text-xs gap-1.5 font-medium";

  return (
    <span
      className={`inline-flex items-center rounded-full border shadow-sm ${badgeStyle} ${sizeClasses} ${className}`}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : size === "lg" ? "h-4.5 w-4.5" : "h-3.5 w-3.5"} />
      <span>{label}</span>
    </span>
  );
}
