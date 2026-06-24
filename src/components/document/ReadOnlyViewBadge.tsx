import { Eye } from "lucide-react";

export default function ReadOnlyViewBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-700">
      <Eye className="h-3.5 w-3.5" />
      Read Only View
    </span>
  );
}
