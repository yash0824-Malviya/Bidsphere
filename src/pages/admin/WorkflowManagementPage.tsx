import { useLayoutEffect, useMemo, useState, type DragEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  GripVertical,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import toast from "react-hot-toast";

import { getWorkflowStages, saveWorkflowStages } from "../../api/admin";
import type { WorkflowStage } from "../../api/admin";
import { useOptionalLayout } from "../../contexts/LayoutContext";

const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  rfq_creation: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  supplier_quotation: { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
  ai_analysis: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  legal_review: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  finance_review: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  po_created: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  supplier_confirmation: {
    bg: "bg-cyan-50",
    text: "text-cyan-800",
    border: "border-cyan-300",
  },
  in_transit: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  grn_received: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  invoice_generated: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  supplier_payment_confirmation: {
    bg: "bg-green-50",
    text: "text-green-800",
    border: "border-green-300",
  },
  payment_completed: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
};

function sortStages(stages: WorkflowStage[]): WorkflowStage[] {
  return [...stages].sort((a, b) => a.order - b.order);
}

export default function WorkflowManagementPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [stages, setStages] = useState<WorkflowStage[]>(() =>
    sortStages(getWorkflowStages())
  );
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const orderedStages = useMemo(() => sortStages(stages), [stages]);
  const enabledStages = useMemo(
    () => orderedStages.filter((s) => s.enabled),
    [orderedStages]
  );

  function toggleStage(name: string) {
    setStages((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
    setDirty(true);
  }

  function reorderStages(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setStages((prev) => {
      const sorted = sortStages(prev);
      const next = [...sorted];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((stage, index) => ({ ...stage, order: index + 1 }));
    });
    setDirty(true);
  }

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    setDropIndex(index);
  }

  function handleDrop(index: number) {
    if (dragIndex !== null) {
      reorderStages(dragIndex, index);
    }
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleSave() {
    saveWorkflowStages(sortStages(stages));
    setDirty(false);
    toast.success("Workflow configuration saved");
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50">
            <GitBranch className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Workflow Management</h1>
            <p className="text-[11px] text-neutral-500">
              Configure the BidSphere end-to-end procurement lifecycle
            </p>
          </div>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-none bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700"
          >
            <Save className="h-3 w-3" /> Save Configuration
          </button>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Active Procurement Workflow
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          {enabledStages.map((stage, idx) => {
            const colors = STAGE_COLORS[stage.name] ?? {
              bg: "bg-neutral-50",
              text: "text-neutral-700",
              border: "border-neutral-200",
            };
            return (
              <div key={stage.name} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${colors.bg} ${colors.border}`}
                >
                  <CheckCircle2 className={`h-3 w-3 ${colors.text}`} />
                  <span className={`text-[11px] font-semibold ${colors.text}`}>
                    {stage.order}. {stage.label}
                  </span>
                </div>
                {idx < enabledStages.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <h2 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        Stage Configuration
      </h2>
      <div className="space-y-1.5">
        {orderedStages.map((stage, index) => {
          const colors = STAGE_COLORS[stage.name] ?? {
            bg: "bg-neutral-50",
            text: "text-neutral-700",
            border: "border-neutral-200",
          };
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== index;

          return (
            <div
              key={stage.name}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm transition ${
                stage.enabled ? "border-neutral-200" : "border-neutral-100 opacity-60"
              } ${isDragging ? "opacity-50" : ""} ${
                isDropTarget ? "border-primary-400 ring-2 ring-primary-100" : ""
              }`}
            >
              <GripVertical className="h-4 w-4 cursor-grab text-neutral-400 active:cursor-grabbing" />

              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.bg}`}>
                <span className={`text-xs font-bold ${colors.text}`}>{stage.order}</span>
              </div>

              <div className="flex-1">
                <p className="text-xs font-semibold text-neutral-900">{stage.label}</p>
                <p className="text-[10px] text-neutral-500">
                  Stage {stage.order} of {orderedStages.length}
                </p>
              </div>

              <span
                className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                  stage.enabled
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {stage.enabled ? "Enabled" : "Disabled"}
              </span>

              <button
                type="button"
                onClick={() => toggleStage(stage.name)}
                className="cursor-pointer border-none bg-transparent p-1 transition hover:opacity-80"
                title={stage.enabled ? "Disable stage" : "Enable stage"}
              >
                {stage.enabled ? (
                  <ToggleRight className="h-5 w-5 text-emerald-600" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-neutral-400" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
