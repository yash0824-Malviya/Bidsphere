import { CheckCircle2, Circle, Loader2 } from "lucide-react";

export type BomProcessPhase =
  | "uploading"
  | "parsing"
  | "validating"
  | "suppliers"
  | "generating"
  | "completed"
  | "failed";

export interface BomProcessStep {
  id: BomProcessPhase;
  label: string;
  state: "completed" | "running" | "pending" | "failed";
}

const PROC_STEP_LABELS: Array<{ id: BomProcessPhase; label: string }> = [
  { id: "uploading", label: "Uploading File" },
  { id: "parsing", label: "Parsing Excel" },
  { id: "validating", label: "Validating Items" },
  { id: "suppliers", label: "Checking Supplier Mapping" },
  { id: "generating", label: "Generating RFQ" },
  { id: "completed", label: "Completed" },
];

const DEPT_STEP_LABELS: Array<{ id: BomProcessPhase; label: string }> = [
  { id: "uploading", label: "Uploading File" },
  { id: "parsing", label: "Parsing Excel" },
  { id: "validating", label: "ERP Item Validation" },
  { id: "suppliers", label: "Routing Temporary Items" },
  { id: "generating", label: "Generating Material Request" },
  { id: "completed", label: "Completed" },
];

/** Map wizard / upload state to pipeline steps for the processing panel. */
export function buildBomProcessSteps(input: {
  uploading: boolean;
  creating: boolean;
  wizardStep: "upload" | "preview" | "suppliers" | "done";
  failed: boolean;
  workflow?: "department" | "procurement";
}): { steps: BomProcessStep[]; progressPct: number; visible: boolean } {
  const { uploading, creating, wizardStep, failed, workflow = "procurement" } = input;
  const STEP_LABELS = workflow === "department" ? DEPT_STEP_LABELS : PROC_STEP_LABELS;

  if (wizardStep === "upload" && !uploading && !failed) {
    return { steps: [], progressPct: 0, visible: false };
  }

  let active: BomProcessPhase = "uploading";
  let progressPct = 12;

  if (failed) {
    active = uploading ? "uploading" : wizardStep === "preview" ? "validating" : "parsing";
    progressPct = active === "uploading" ? 18 : active === "parsing" ? 32 : 48;
  } else if (uploading) {
    active = "parsing";
    progressPct = 38;
  } else if (creating) {
    active = "generating";
    progressPct = 88;
  } else if (wizardStep === "done") {
    active = "completed";
    progressPct = 100;
  } else if (wizardStep === "suppliers") {
    active = "suppliers";
    progressPct = 72;
  } else if (wizardStep === "preview") {
    active = "validating";
    progressPct = 56;
  }

  const order = STEP_LABELS.map((s) => s.id);
  const activeIdx = order.indexOf(active);

  const steps: BomProcessStep[] = STEP_LABELS.map((s, idx) => {
    if (failed && s.id === active) {
      return { ...s, state: "failed" };
    }
    if (idx < activeIdx) return { ...s, state: "completed" };
    if (idx === activeIdx) {
      return {
        ...s,
        state: failed ? "failed" : s.id === "completed" && progressPct === 100 ? "completed" : "running",
      };
    }
    return { ...s, state: "pending" };
  });

  return { steps, progressPct, visible: true };
}

interface Props {
  fileName?: string | null;
  steps: BomProcessStep[];
  progressPct: number;
  failed?: boolean;
  errorMessage?: string | null;
}

export default function BomProcessingStatusPanel({
  fileName,
  steps,
  progressPct,
  failed,
  errorMessage,
}: Props) {
  if (!steps.length) return null;

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[#1E293B]">Processing Status</h3>
          {fileName ? (
            <p className="mt-0.5 truncate text-[12px] text-[#64748B]">{fileName}</p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            failed
              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
              : progressPct >= 100
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-[#EEF3FA] text-[#1F3A6D] ring-1 ring-[#CBD5E1]"
          }`}
        >
          {failed ? "Failed" : progressPct >= 100 ? "Completed" : "In progress"}
        </span>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-[#64748B]">
          <span>{failed ? "Processing stopped" : "Overall progress"}</span>
          <span className="tabular-nums text-[#1E293B]">{Math.round(progressPct)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[#EEF2F7]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              failed ? "bg-rose-500" : progressPct >= 100 ? "bg-emerald-500" : "bg-[#1F3A6D]"
            }`}
            style={{ width: `${Math.min(100, Math.max(failed ? progressPct : 8, progressPct))}%` }}
          />
        </div>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-3 rounded-lg border border-[#F1F5F9] bg-[#FAFBFC] px-3 py-2"
          >
            <StepIcon state={step.state} />
            <span
              className={`flex-1 text-[13px] font-medium ${
                step.state === "pending"
                  ? "text-[#94A3B8]"
                  : step.state === "failed"
                    ? "text-rose-700"
                    : "text-[#1E293B]"
              }`}
            >
              {step.label}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide ${
                step.state === "completed"
                  ? "text-emerald-600"
                  : step.state === "running"
                    ? "text-[#1F3A6D]"
                    : step.state === "failed"
                      ? "text-rose-600"
                      : "text-[#CBD5E1]"
              }`}
            >
              {step.state === "completed"
                ? "Completed"
                : step.state === "running"
                  ? "Running"
                  : step.state === "failed"
                    ? "Failed"
                    : "Pending"}
            </span>
          </li>
        ))}
      </ol>

      {failed && errorMessage ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

function StepIcon({ state }: { state: BomProcessStep["state"] }) {
  if (state === "completed") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
  }
  if (state === "running") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1F3A6D]" aria-hidden />;
  }
  if (state === "failed") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700">
        !
      </span>
    );
  }
  return <Circle className="h-4 w-4 shrink-0 text-[#CBD5E1]" aria-hidden />;
}
