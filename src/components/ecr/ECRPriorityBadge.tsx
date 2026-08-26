import type { ECRPriority } from "../../types/erpnext";

const STYLES: Record<ECRPriority, string> = {
  Low: "bg-neutral-100 text-neutral-600",
  Medium: "bg-blue-50 text-blue-700",
  High: "bg-orange-50 text-orange-700",
  Critical: "bg-rose-50 text-rose-700",
};

export default function ECRPriorityBadge({
  priority = "Medium",
}: {
  priority?: ECRPriority;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}
