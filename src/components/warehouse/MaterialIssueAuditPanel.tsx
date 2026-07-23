import { useState } from "react";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";

import type { MaterialIssueDisplayAudit } from "../../utils/materialIssueRemarksDisplay";
import type { MaterialIssueReceiptAuditEntry } from "../../types/materialIssueReceipt";

/**
 * Collapsed-by-default technical audit section for Issue Slip / Receipt.
 * Business users see readable remarks; admins expand for metadata + JSON.
 */
export default function MaterialIssueAuditPanel({
  audit,
  auditTrail,
  documentHash,
  verificationToken,
}: {
  audit: MaterialIssueDisplayAudit;
  auditTrail?: MaterialIssueReceiptAuditEntry[];
  documentHash?: string;
  verificationToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasTrail = Boolean(auditTrail?.length);
  const hasPayload = Boolean(audit.json_payload);

  if (
    !audit.created_by &&
    !audit.browser &&
    !audit.device &&
    !audit.issue_type &&
    !hasPayload &&
    !hasTrail &&
    !documentHash
  ) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Shield className="h-4 w-4 text-slate-500" />
          Audit Information
          <span className="text-xs font-normal text-slate-400">
            (technical metadata)
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-5 py-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Created By", audit.created_by],
              ["Created At", audit.created_at],
              ["Warehouse", audit.warehouse],
              ["Issue Type", audit.issue_type],
              ["Receiver", audit.receiver],
              ["Browser", audit.browser],
              ["Device", audit.device],
              ["User Agent", audit.user_agent],
              ["Request ID", audit.request_id],
              [
                "Document Hash",
                documentHash
                  ? `${documentHash.slice(0, 24)}…`
                  : undefined,
              ],
              ["Verification Token", verificationToken],
            ].map(([label, value]) =>
              value ? (
                <div key={label as string}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {label}
                  </dt>
                  <dd className="mt-0.5 break-all font-medium text-slate-800">
                    {value}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>

          {hasTrail ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Audit Trail
              </h4>
              <ul className="max-h-56 space-y-2 overflow-y-auto text-xs text-slate-600">
                {auditTrail!.map((a) => (
                  <li key={a.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                    <p className="font-medium text-slate-800">{a.action}</p>
                    <p>
                      {a.by} · {a.at}
                    </p>
                    {a.detail ? (
                      <p className="text-slate-500">{a.detail}</p>
                    ) : null}
                    {a.hash ? (
                      <p className="font-mono text-[10px] text-slate-400">
                        {a.hash.slice(0, 24)}…
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasPayload ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                JSON Payload
              </h4>
              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-200">
                {audit.json_payload}
              </pre>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Stored for auditing and cross-system sync. Not shown on the
                business Issue Slip body.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
