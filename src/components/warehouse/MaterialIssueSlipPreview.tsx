import { Loader2, Printer, X } from "lucide-react";
import { useState } from "react";

import {
  downloadMaterialIssuePdf,
  printMaterialIssuePdf,
  type MaterialIssuePdfData,
} from "../../utils/pdf/materialIssuePdf";
import { formatDate } from "../../utils/format";

interface Props {
  open: boolean;
  onClose: () => void;
  data: MaterialIssuePdfData;
}

export default function MaterialIssueSlipPreview({
  open,
  onClose,
  data,
}: Props) {
  const [busy, setBusy] = useState<"print" | "pdf" | null>(null);

  if (!open) return null;

  const run = async (mode: "print" | "pdf") => {
    setBusy(mode);
    try {
      if (mode === "print") await printMaterialIssuePdf(data);
      else await downloadMaterialIssuePdf(data);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-[16px] font-semibold text-slate-900">
              Issue Slip Preview
            </h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {data.temporary
                ? "Temporary preview — Issue Number assigned on submit."
                : "Material Issue slip ready to print or download."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Issue Number
              </dt>
              <dd className="font-mono font-semibold text-slate-900">
                {data.issue_number}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Material Request
              </dt>
              <dd className="font-medium text-slate-900">{data.mr_name}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Department
              </dt>
              <dd>{data.department || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Warehouse
              </dt>
              <dd>{data.warehouse || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Issued By
              </dt>
              <dd>{data.issued_by || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Receiver
              </dt>
              <dd>{data.receiver || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Issue Date
              </dt>
              <dd>
                {data.issue_date ? formatDate(data.issue_date) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Issue Type
              </dt>
              <dd>{data.issue_type}</dd>
            </div>
          </dl>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Required</th>
                  <th className="px-3 py-2 text-right">Issued</th>
                  <th className="px-3 py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((it) => (
                  <tr key={it.item_code}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">
                        {it.item_name || it.item_code}
                      </p>
                      <p className="text-[10px] text-slate-400">{it.item_code}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {it.required_qty}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {it.issued_qty}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {it.remaining_qty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-[12px] text-slate-400">
              Signature Placeholder
              <p className="mt-1 font-medium text-slate-600">Warehouse Manager</p>
            </div>
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-[12px] text-slate-400">
              Signature Placeholder
              <p className="mt-1 font-medium text-slate-600">Receiver</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("print")}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "print" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Print
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("pdf")}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy === "pdf" ? (
              <Loader2 className="inline h-4 w-4 animate-spin" />
            ) : null}{" "}
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
