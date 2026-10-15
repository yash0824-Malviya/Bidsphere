import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Home,
  Package,
  QrCode,
  Warehouse,
} from "lucide-react";
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
import {
  parseStructuredWarehouseProcessing,
} from "../../../utils/materialIssueRemarksDisplay";
import {
  getPublicAppOrigin,
  isPublicAppOriginLoopback,
  probeVerificationServiceAvailable,
} from "../../../utils/publicAppUrl";
import MaterialIssueAuditPanel from "../MaterialIssueAuditPanel";
import { AttachmentsCell, PartNameCell } from "../EngineeringDocCells";

type Audience = "warehouse" | "department";

export default function MaterialIssueReceiptView({
  receipt,
  audience = "department",
  actions,
  children,
}: {
  receipt: MaterialIssueReceipt;
  audience?: Audience;
  actions?: React.ReactNode;
  /** Signature / accept actions slot */
  children?: React.ReactNode;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [verifyReachable, setVerifyReachable] = useState<
    "checking" | "ok" | "unavailable"
  >("checking");

  const timeline = buildReceiptTimeline(receipt);
  const statusLabel = receiptStatusDisplayLabel(receipt.status, audience);

  const structuredProcessing = useMemo(() => {
    return parseStructuredWarehouseProcessing(receipt.remarks, receipt);
  }, [receipt]);

  const verifyUrl = receiptVerificationUrl(receipt);
  const publicOrigin = getPublicAppOrigin();

  useEffect(() => {
    void QRCode.toDataURL(verifyUrl, {
      width: 180,
      margin: 1,
    }).then(setQrUrl);
  }, [verifyUrl, publicOrigin]);

  useEffect(() => {
    let cancelled = false;
    setVerifyReachable("checking");
    if (isPublicAppOriginLoopback()) {
      setVerifyReachable("unavailable");
      return;
    }
    void probeVerificationServiceAvailable().then((ok) => {
      if (!cancelled) setVerifyReachable(ok ? "ok" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [verifyUrl]);

  const deptAwaiting =
    !receipt.department_signature &&
    receipt.status !== "Acceptance Rejected" &&
    receipt.status !== "Confirmed";

  // Items Totals & Progress Calculation
  const totals = useMemo(() => {
    let requested = 0;
    let issued = 0;
    let remaining = 0;

    for (const it of receipt.items) {
      requested += Number(it.requested_qty) || 0;
      issued += Number(it.issued_qty) || 0;
      remaining += Number(it.remaining_qty) || 0;
    }

    const pct = requested > 0 ? Math.min(100, Math.round((issued / requested) * 100)) : 100;
    return { requested, issued, remaining, pct };
  }, [receipt.items]);

  const isConfirmed =
    receipt.status === "Confirmed" || Boolean(receipt.department_signature);

  return (
    <div className="w-full space-y-6">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* 1. Breadcrumbs & Top Header                                 */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5" aria-label="Breadcrumb">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1 hover:text-slate-900 transition"
            >
              <Home className="h-3.5 w-3.5" />
              <span>Home</span>
            </Link>
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <Link
              to={
                audience === "department"
                  ? "/department/issued-items/issue-receipts"
                  : "/warehouse/issue-items/receipts"
              }
              className="hover:text-slate-900 transition"
            >
              Issued Items
            </Link>
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <span className="font-semibold text-slate-800">
              Material Issue Receipt
            </span>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px]">
              Material Issue Receipt
            </h1>
            <span className="font-mono text-sm font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200">
              {receipt.issue_number}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {statusLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={receipt.status} size="lg" />
          {actions}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2. Business Information Grid (Compact Two-Column Layout)    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 border-b border-slate-100 pb-2">
          Business Information
        </h2>
        <dl className="grid grid-cols-1 gap-y-3.5 gap-x-6 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-xs text-slate-500">MR Number</dt>
            <dd className="mt-0.5 font-mono font-semibold text-primary-700">
              <Link
                to={`/material-requests/${encodeURIComponent(receipt.mr_name)}`}
                className="hover:underline"
              >
                {receipt.mr_name}
              </Link>
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Company</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {receipt.company || "Netlink"}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Warehouse</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {receipt.warehouse || "—"}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Received By</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {receipt.received_by || "Department User"}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Issue Type</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {receipt.issue_type || "Full Issue"}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Issue Date</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {formatDate(receipt.issue_date)}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Priority</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              Medium
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {receipt.status}
            </dd>
          </div>
        </dl>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 3. Requested Items Table & Progress Visualization           */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                REQUESTED ITEMS
              </h2>
              <p className="text-xs text-slate-500">
                Line items issued from warehouse inventory
              </p>
            </div>
          </div>

          {/* Top Right Summary Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
              <span>Requested</span>
              <span className="tabular-nums font-bold text-slate-900">{totals.requested}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <span>Issued</span>
              <span className="tabular-nums font-bold text-emerald-900">{totals.issued}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              <span>Remaining</span>
              <span className="tabular-nums font-bold text-slate-800">{totals.remaining}</span>
            </span>
          </div>
        </div>

        {/* Progress / Quantity Visualization */}
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800">
              {totals.issued} / {totals.requested} Issued
            </span>
            <span className="text-xs font-semibold text-emerald-700">
              ({totals.pct}% Complete)
            </span>
          </div>
          <div className="w-full sm:w-64 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${totals.pct}%` }}
            />
          </div>
        </div>

        {/* Items Table */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2.5 px-3">Item Code</th>
                <th className="py-2.5 px-3">Item Name</th>
                <th className="py-2.5 px-3 text-right">Requested</th>
                <th className="py-2.5 px-3">Part Name</th>
                <th className="py-2.5 px-3">Attachments</th>
                <th className="py-2.5 px-3 text-right">Issued</th>
                <th className="py-2.5 px-3 text-right">Remaining</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipt.items.map((item) => {
                const req = Number(item.requested_qty) || 0;
                const iss = Number(item.issued_qty) || 0;
                const rem = Number(item.remaining_qty) || 0;
                const itemStatus = rem === 0 ? "Issued" : iss > 0 ? "Partially Issued" : "Pending";

                return (
                  <tr key={item.item_code} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {item.item_code}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800">
                      {item.item_name}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-700">
                      {req} {item.uom || "Nos"}
                    </td>
                    <td className="py-3 px-3">
                      <PartNameCell value={item.remarks} />
                    </td>
                    <td className="py-3 px-3">
                      <AttachmentsCell />
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-bold text-emerald-700">
                      {iss} {item.uom || "Nos"}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-slate-600">
                      {rem} {item.uom || "Nos"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <StatusBadge status={itemStatus} size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4. REDESIGNED WAREHOUSE PROCESSING & REMARKS SECTION         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Warehouse className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              WAREHOUSE PROCESSING
            </h2>
            <p className="text-xs text-slate-500">
              Fulfillment summary, stock entry reference, and acceptance verification
            </p>
          </div>
        </div>

        {/* Structured Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Status</span>
            <div className="mt-1 flex items-center gap-1.5 font-bold text-emerald-800 text-sm">
              <Check className="h-4 w-4 text-emerald-600 stroke-[3]" />
              {structuredProcessing.status}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Material Issue Receipt</span>
            <div className="mt-1 font-mono font-bold text-slate-900 text-sm">
              {structuredProcessing.issueNumber}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Stock Entry</span>
            <div className="mt-1 font-mono font-bold text-slate-900 text-sm">
              {structuredProcessing.stockEntry}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Warehouse</span>
            <div className="mt-1 font-semibold text-slate-800 text-sm">
              {structuredProcessing.warehouse}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Received By</span>
            <div className="mt-1 font-semibold text-slate-800 text-sm">
              {structuredProcessing.receivedBy}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Issue Type</span>
            <div className="mt-1 font-semibold text-slate-800 text-sm">
              {structuredProcessing.issueType}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Issue Date</span>
            <div className="mt-1 font-semibold text-slate-800 text-sm">
              {structuredProcessing.issueDate}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Department Acceptance</span>
            <div className="mt-1 flex items-center gap-1.5 font-bold text-emerald-800 text-sm">
              {isConfirmed ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600 stroke-[3]" />
                  Confirmed ({structuredProcessing.acceptanceDate})
                </>
              ) : (
                <span className="text-amber-700">Pending</span>
              )}
            </div>
          </div>
        </div>

        {/* Acceptance Checklist */}
        {structuredProcessing.acceptanceChecklist && (
          <div className="mt-4 rounded-lg border border-slate-200/80 bg-slate-50/40 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2.5">
              Acceptance Checklist
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {(
                Object.keys(ACCEPTANCE_CHECKLIST_LABELS) as Array<
                  keyof typeof ACCEPTANCE_CHECKLIST_LABELS
                >
              ).map((key) => {
                const checked = Boolean(structuredProcessing.acceptanceChecklist?.[key]);
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-md bg-white border border-slate-200/80 px-3 py-2 text-xs font-medium text-slate-800 shadow-2xs"
                  >
                    {checked ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-300 shrink-0" />
                    )}
                    <span>{ACCEPTANCE_CHECKLIST_LABELS[key]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Clean Human Remarks */}
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
            Warehouse Remarks
          </h3>
          <p className="text-sm text-slate-700">
            {structuredProcessing.humanRemarks || "No warehouse remarks added."}
          </p>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 5. Timeline & Signatures                                     */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Timeline (5 Cols) */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs lg:col-span-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 mb-3 border-b border-slate-100 pb-2">
              Timeline
            </h2>
            <ol className="space-y-3.5">
              {timeline.map((step) => (
                <li key={step.key} className="flex items-start gap-3 text-xs">
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : step.current ? (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <div>
                    <p
                      className={`font-semibold ${
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
                      <p className="text-[11px] text-slate-500 mt-0.5">{step.at}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Digital Signatures (7 Cols) */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs lg:col-span-7 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 mb-3 border-b border-slate-100 pb-2">
              Digital Signatures
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Warehouse Signature
                </span>
                {receipt.warehouse_signature ? (
                  <div className="mt-2 space-y-1">
                    <p className="inline-flex items-center gap-1 font-bold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Valid Digital Signature
                    </p>
                    <p className="font-semibold text-slate-900">
                      {receipt.warehouse_signature.signer_name}
                    </p>
                    <p className="text-[11px] text-slate-500">Warehouse Manager</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTime(receipt.warehouse_signature.signed_at)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-amber-700 font-semibold">Pending Signature</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Department Signature
                </span>
                {receipt.department_signature ? (
                  <div className="mt-2 space-y-1">
                    <p className="inline-flex items-center gap-1 font-bold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Valid Digital Signature
                    </p>
                    <p className="font-semibold text-slate-900">
                      {receipt.department_signature.signer_name}
                    </p>
                    <p className="text-[11px] text-slate-500">Department User</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTime(
                        receipt.department_signature.signed_at ||
                          receipt.confirmed_at ||
                          "",
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1">
                    <p className="font-semibold text-amber-800">
                      {receipt.status === "Acceptance Rejected" ? "Rejected" : "Pending Acceptance"}
                    </p>
                    {deptAwaiting ? (
                      <p className="text-[11px] text-slate-500">
                        Awaiting department acceptance confirmation.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Acceptance actions slot (if pending acceptance) */}
      {children}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 6. QR Verification                                           */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {verifyReachable === "unavailable" ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center max-w-sm">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <p className="text-xs font-semibold text-amber-900">
                Verification QR Service
              </p>
              <p className="text-[11px] text-amber-800">
                QR code is available on reachable network hosts.
              </p>
            </div>
          ) : qrUrl ? (
            <img
              src={qrUrl}
              alt="Receipt verification QR"
              className="h-32 w-32 shrink-0 border border-slate-200 rounded-lg p-1 bg-white"
            />
          ) : (
            <div className="h-32 w-32 animate-pulse rounded-lg bg-slate-100 shrink-0" />
          )}

          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <QrCode className="h-4 w-4 text-primary-600" />
              Receipt Authenticity Verification
            </div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed max-w-md">
              Scan this QR code using any smartphone or scanner to verify the digital authenticity and tamper-evident status of this Material Issue Receipt.
            </p>
            <a
              href={verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center text-xs font-semibold text-primary-700 hover:text-primary-800 hover:underline"
            >
              Open Public Verification Link →
            </a>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 7. Collapsible "View Audit Details" Panel                    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <MaterialIssueAuditPanel
        audit={structuredProcessing.audit}
        auditTrail={receipt.audit_trail}
        documentHash={receipt.document_hash}
        verificationToken={receipt.verification_token}
      />
    </div>
  );
}
