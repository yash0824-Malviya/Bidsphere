import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { verifyMaterialIssueReceipt } from "../../api/materialIssueReceipt";
import StatusBadge from "../../components/StatusBadge";
import { formatDate, formatDateTime } from "../../utils/format";

/**
 * Public-style verification page opened from receipt QR codes.
 * Supports:
 *   /verify/material-issue?issue=MAT-STE-2026-00025  (preferred)
 *   /verify/material-issue?id=<MIR issue number>
 *   /verify/material-issue-receipt/:id
 */
export default function MaterialIssueReceiptVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const fromQuery =
    searchParams.get("issue") ||
    searchParams.get("id") ||
    searchParams.get("token");
  const key = decodeURIComponent(String(fromQuery || token || "").trim());

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[verify] QR parameter received (page):", key || "(empty)");
  }, [key]);

  const verifyQuery = useQuery({
    queryKey: ["material-issue-receipt-verify", key],
    enabled: !!key,
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[verify] API request: verifyMaterialIssueReceipt", key);
      return verifyMaterialIssueReceipt(key);
    },
    retry: 1,
  });

  if (!key) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-danger-700">
        Unable to verify this receipt. Missing issue identifier in the QR URL.
      </div>
    );
  }

  if (verifyQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verifying receipt…
      </div>
    );
  }

  if (verifyQuery.isError) {
    // eslint-disable-next-line no-console
    console.error("[verify] API request failed:", verifyQuery.error);
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-danger-700">
        Unable to verify this receipt. Verification service error.
      </div>
    );
  }

  const result = verifyQuery.data;
  if (!result) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-danger-700">
        Unable to verify this receipt.
      </div>
    );
  }

  const receipt = result.receipt;
  const notFound = result.status === "Not Found" || !receipt;
  const tampered =
    result.status === "Tampered" || result.document_integrity === "Tampered";
  const signaturesInvalid =
    Boolean(receipt?.warehouse_signature) &&
    result.warehouse_signature_valid === false &&
    tampered;

  // Failure only for not found / hash mismatch (tampered) / invalid signatures.
  if (notFound || tampered || signaturesInvalid) {
    const failureMessage = notFound
      ? "Receipt not found for this Material Issue."
      : tampered || result.hash_valid === false
        ? "Hash mismatch — document integrity check failed."
        : "Signatures are invalid for this receipt.";

    return (
      <div className="mx-auto max-w-lg space-y-4 p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-rose-100 text-rose-800">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Unable to verify this receipt
        </h1>
        <p className="text-sm text-danger-700">{failureMessage}</p>
        {key ? (
          <p className="font-mono text-xs text-slate-500">Issue: {key}</p>
        ) : null}
      </div>
    );
  }

  if (!result.success || !receipt) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-danger-700">
        Unable to verify this receipt.
      </div>
    );
  }

  const integrity = result.document_integrity || "Pending";
  const whValid = Boolean(result.warehouse_signature_valid);
  const deptValid = Boolean(result.department_signature_valid);
  const ok = integrity === "Verified" && (result.verified || whValid);

  return (
    <div className="mx-auto max-w-lg space-y-5 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span
            className={`grid h-12 w-12 place-items-center rounded-xl ${
              ok
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Receipt Verification
            </h1>
            <p className="text-sm text-slate-500">{result.message}</p>
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Stock Entry / Issue</dt>
            <dd className="font-mono font-semibold">
              {receipt?.stock_entry ||
                receipt?.issue_number ||
                result.document_number}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Receipt Number</dt>
            <dd className="font-mono font-medium">
              {receipt?.issue_number || "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Material Request</dt>
            <dd className="font-mono font-medium">
              {receipt?.mr_name || "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Company</dt>
            <dd className="font-medium">{receipt?.company || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Warehouse</dt>
            <dd className="font-medium">{receipt?.warehouse || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Receiver</dt>
            <dd className="font-medium">{receipt?.received_by || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Issue Date</dt>
            <dd>
              {receipt?.issue_date
                ? formatDate(receipt.issue_date)
                : result.created_date}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Warehouse Signature</dt>
            <dd
              className={`font-semibold ${
                whValid ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {whValid ? "✔ Valid" : "Pending"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Department Signature</dt>
            <dd
              className={`font-semibold ${
                deptValid ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {deptValid
                ? "✔ Valid"
                : receipt?.status === "Acceptance Rejected"
                  ? "Rejected"
                  : "Pending"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Document Integrity</dt>
            <dd
              className={`font-semibold ${
                integrity === "Verified"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }`}
            >
              {integrity === "Verified"
                ? "✔ Verified"
                : result.hash_valid
                  ? "✔ Hash Valid"
                  : "Pending"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Workflow Status</dt>
            <dd>
              {typeof result.status === "string" ? (
                <StatusBadge status={result.status} />
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="border-b border-slate-100 pb-2">
            <dt className="mb-1 text-slate-500">SHA256 Hash (Business)</dt>
            <dd className="break-all font-mono text-[11px] text-slate-700">
              {result.stored_hash || receipt?.document_hash || "—"}
            </dd>
          </div>
          {receipt?.warehouse_signature ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Warehouse</p>
              <p>
                {receipt.warehouse_signature.signer_name} ·{" "}
                {formatDateTime(receipt.warehouse_signature.signed_at)}
              </p>
            </div>
          ) : null}
          {receipt?.department_signature ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <p className="font-semibold">Department Accepted</p>
              <p>
                {receipt.department_signature.signer_name} ·{" "}
                {formatDateTime(receipt.department_signature.signed_at)}
              </p>
            </div>
          ) : null}
          {result.signed_by.length ? (
            <div>
              <dt className="mb-1 text-slate-500">Signed By</dt>
              <dd>
                <ul className="space-y-1">
                  {result.signed_by.map((name) => (
                    <li
                      key={name}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      {name}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <p className="text-center text-xs text-slate-400">
        <Link to="/" className="text-primary-700 hover:underline">
          BidSphere
        </Link>{" "}
        · Material Issue Receipt verification
      </p>
    </div>
  );
}
