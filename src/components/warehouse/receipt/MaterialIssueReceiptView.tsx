import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, QrCode, XCircle } from "lucide-react";
import QRCode from "qrcode";

import { receiptVerificationUrl } from "../../../api/materialIssueReceipt";
import StatusBadge from "../../StatusBadge";
import { formatDate, formatDateTime } from "../../../utils/format";
import type { MaterialIssueReceipt } from "../../../types/materialIssueReceipt";
import {
  ACCEPTANCE_CHECKLIST_LABELS,
  buildReceiptTimeline,
  receiptStatusDisplayLabel,
} from "../../../types/materialIssueReceipt";
import { splitMaterialIssueRemarksForDisplay } from "../../../utils/materialIssueRemarksDisplay";
import MaterialIssueAuditPanel from "../MaterialIssueAuditPanel";

type Audience = "warehouse" | "department";

export default function MaterialIssueReceiptView({
  receipt,
  audience = "warehouse",
  children,
}: {
  receipt: MaterialIssueReceipt;
  audience?: Audience;
  /** Signature / accept actions slot */
  children?: React.ReactNode;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const timeline = buildReceiptTimeline(receipt);
  const statusLabel = receiptStatusDisplayLabel(receipt.status, audience);

  const remarksDisplay = useMemo(
    () =>
      splitMaterialIssueRemarksForDisplay(receipt.remarks, {
        items: receipt.items.map((i) => ({
          item_code: i.item_code,
          item_name: i.item_name,
          requested_qty: i.requested_qty,
          issued_qty: i.issued_qty,
          remaining_qty: i.remaining_qty,
          uom: i.uom,
        })),
      }),
    [receipt.remarks, receipt.items],
  );

  const auditForPanel = useMemo(
    () => ({
      ...remarksDisplay.audit,
      created_by:
        remarksDisplay.audit.created_by ||
        receipt.warehouse_signature?.signer_name ||
        receipt.issued_by,
      created_at:
        remarksDisplay.audit.created_at ||
        receipt.warehouse_signed_at ||
        receipt.created_at,
      warehouse: remarksDisplay.audit.warehouse || receipt.warehouse,
      issue_type: remarksDisplay.audit.issue_type || receipt.issue_type,
      receiver: remarksDisplay.audit.receiver || receipt.received_by,
      browser:
        remarksDisplay.audit.browser ||
        receipt.warehouse_signature?.browser ||
        receipt.audit_trail.find((a) => a.browser)?.browser,
      device:
        remarksDisplay.audit.device ||
        receipt.warehouse_signature?.device ||
        receipt.audit_trail.find((a) => a.device)?.device,
    }),
    [remarksDisplay.audit, receipt],
  );

  const verifyUrl = receiptVerificationUrl(receipt);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[QR] Material Issue verification URL:", verifyUrl);
    void QRCode.toDataURL(verifyUrl, {
      width: 180,
      margin: 1,
    }).then(setQrUrl);
  }, [verifyUrl]);

  const deptAwaiting =
    !receipt.department_signature &&
    receipt.status !== "Acceptance Rejected" &&
    receipt.status !== "Confirmed";
  const businessLocked = Boolean(
    receipt.warehouse_signature ||
      receipt.status === "Pending Department Acceptance" ||
      receipt.status === "Confirmed",
  );

  return (
    <div className="space-y-5">
      {/* Header summary */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {receipt.issue_number}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-neutral-900">
              Material Issue Receipt
            </h1>
            <p className="mt-1 text-sm text-slate-500">{statusLabel}</p>
          </div>
          <StatusBadge status={receipt.status} size="lg" />
        </div>
        {businessLocked ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Business fields are locked after Warehouse Signature. Only Department
            Acceptance (checklist, remarks, signature) can change.
          </div>
        ) : null}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">Material Request</dt>
            <dd className="font-mono font-medium">{receipt.mr_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Stock Entry</dt>
            <dd className="font-mono font-medium">
              {receipt.stock_entry || "—"}
            </dd>
          </div>
          {audience !== "department" ? (
            <div>
              <dt className="text-xs text-neutral-500">Department</dt>
              <dd className="font-medium">{receipt.department || "—"}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-neutral-500">Company</dt>
            <dd className="font-medium">{receipt.company || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Warehouse</dt>
            <dd className="font-medium">{receipt.warehouse || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Warehouse Manager</dt>
            <dd className="font-medium">
              {receipt.warehouse_signature?.signer_name ||
                receipt.issued_by ||
                "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Receiver</dt>
            <dd className="font-medium">{receipt.received_by || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Issue Date</dt>
            <dd className="font-medium">{formatDate(receipt.issue_date)}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Issue Type</dt>
            <dd className="font-medium">{receipt.issue_type || "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Timeline</h2>
        <ol className="space-y-3">
          {timeline.map((step) => (
            <li key={step.key} className="flex items-start gap-3 text-sm">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : step.current ? (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
              )}
              <div>
                <p
                  className={`font-medium ${
                    step.current
                      ? "text-amber-800"
                      : step.done
                        ? "text-slate-900"
                        : "text-slate-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.at ? (
                  <p className="text-xs text-slate-500">{step.at}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Requested Qty</th>
                <th className="px-3 py-2 text-right">Issued Qty</th>
                <th className="px-3 py-2 text-right">Remaining Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipt.items.map((item) => (
                <tr key={item.item_code}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900">
                      {item.item_code}
                    </p>
                    <p className="text-xs text-slate-500">{item.item_name}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.requested_qty} {item.uom}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {item.issued_qty} {item.uom}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.remaining_qty} {item.uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Warehouse Remarks
          </h3>
          {remarksDisplay.bullets.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {remarksDisplay.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No remarks recorded.</p>
          )}
        </div>
      </div>

      {/* Acceptance checklist (read-only once filled) */}
      {receipt.acceptance_checklist ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Acceptance Checklist
          </h2>
          <ul className="space-y-2 text-sm">
            {(
              Object.keys(ACCEPTANCE_CHECKLIST_LABELS) as Array<
                keyof typeof ACCEPTANCE_CHECKLIST_LABELS
              >
            ).map((key) => (
              <li key={key} className="flex items-center gap-2">
                {receipt.acceptance_checklist?.[key] ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-slate-300" />
                )}
                {ACCEPTANCE_CHECKLIST_LABELS[key]}
              </li>
            ))}
          </ul>
          {receipt.department_remarks ? (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium">Department Remarks:</span>{" "}
              {receipt.department_remarks}
            </p>
          ) : null}
        </div>
      ) : null}

      {receipt.status === "Acceptance Rejected" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-semibold">Acceptance Rejected</p>
          <p className="mt-1">
            By {receipt.rejected_by || "—"} at {receipt.rejected_at || "—"}
          </p>
          <p className="mt-1">{receipt.rejection_reason}</p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Digital signatures */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">
              Digital Signatures
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Warehouse Signature
                </p>
                {receipt.warehouse_signature ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      Valid
                    </p>
                    <p className="font-medium text-slate-900">
                      {receipt.warehouse_signature.signer_name}
                    </p>
                    <p className="text-xs text-slate-500">Warehouse Manager</p>
                    <p className="text-xs text-slate-600">
                      <span className="text-slate-400">Signed On · </span>
                      {formatDateTime(receipt.warehouse_signature.signed_at)}
                    </p>
                    <p className="break-all font-mono text-[10px] text-slate-400">
                      SHA256 · {receipt.warehouse_signature.sha256_hash}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-amber-700">Pending</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Department Signature
                </p>
                {receipt.department_signature ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      Valid
                    </p>
                    <p className="font-medium text-slate-900">
                      {receipt.department_signature.signer_name}
                    </p>
                    <p className="text-xs text-slate-600">
                      <span className="text-slate-400">Accepted By · </span>
                      {receipt.department_signature.signer_name}
                    </p>
                    <p className="text-xs text-slate-600">
                      <span className="text-slate-400">Accepted Time · </span>
                      {formatDateTime(
                        receipt.department_signature.signed_at ||
                          receipt.confirmed_at ||
                          "",
                      )}
                    </p>
                    <p className="break-all font-mono text-[10px] text-slate-400">
                      SHA256 · {receipt.department_signature.sha256_hash}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1">
                    <p className="font-semibold text-amber-800">
                      {receipt.status === "Acceptance Rejected"
                        ? "Rejected"
                        : "Pending"}
                    </p>
                    {deptAwaiting ? (
                      <p className="text-xs text-slate-500">
                        Department acceptance does not change the warehouse
                        business hash.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          {children}
        </div>

        <div className="space-y-4">
          <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <QrCode className="h-4 w-4" />
              QR Verification
            </div>
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="Receipt verification QR"
                className="h-40 w-40"
              />
            ) : (
              <div className="h-40 w-40 animate-pulse rounded bg-slate-100" />
            )}
            <p className="mt-4 max-w-[16rem] text-center text-[12px] leading-relaxed text-slate-500">
              Scan this QR using any mobile device to verify the authenticity of
              this Material Issue Receipt.
            </p>
            <a
              href={verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 text-center text-xs font-medium text-primary-700 hover:underline"
            >
              Open Verification Page
            </a>
          </div>
        </div>
      </div>

      <MaterialIssueAuditPanel
        audit={auditForPanel}
        auditTrail={receipt.audit_trail}
        documentHash={receipt.document_hash}
        verificationToken={receipt.verification_token}
      />
    </div>
  );
}
