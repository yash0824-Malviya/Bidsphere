import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Lock, Shield } from "lucide-react";
import toast from "react-hot-toast";

import type { MaterialIssueDisplayAudit } from "../../utils/materialIssueRemarksDisplay";
import type { MaterialIssueReceiptAuditEntry } from "../../types/materialIssueReceipt";
import { useAuthStore } from "../../store/authStore";

interface Props {
  audit: MaterialIssueDisplayAudit;
  auditTrail?: MaterialIssueReceiptAuditEntry[];
  documentHash?: string;
  verificationToken?: string;
}

export default function MaterialIssueAuditPanel({
  audit,
  auditTrail,
  documentHash,
  verificationToken,
}: Props) {
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const isAdmin =
    user?.role === "executive" ||
    user?.role === "warehouse" ||
    user?.email?.includes("admin");

  const handleCopy = (key: string, value?: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const hasTrail = Boolean(auditTrail?.length);
  const docHash = documentHash || audit.document_hash;
  const token = verificationToken || audit.verification_token;
  const whSha = audit.warehouse_sha256;
  const deptSha = audit.department_sha256;

  const standardFields: Array<[string, string | undefined]> = [
    ["Document Version", audit.document_version || "1.0"],
    ["Created At", audit.created_at],
    ["Modified At", audit.modified_at || audit.created_at],
    ["Warehouse Signer", audit.warehouse_signer || audit.created_by || "Warehouse Manager"],
    ["Department Signer", audit.department_signer || "Department User"],
  ].filter(([, val]) => Boolean(val)) as Array<[string, string | undefined]>;

  const hasStandardData = standardFields.length > 0;
  if (!hasStandardData && !hasTrail && !docHash && !token) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50/70"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Shield className="h-4 w-4 text-slate-500" />
          View Audit Details
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-5 py-4 bg-slate-50/40">
          {/* Standard Key/Value Layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-6">
            {standardFields.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {label}
                </span>
                <span className="mt-0.5 text-sm font-medium text-slate-800">
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Audit Trail Events */}
          {hasTrail && (
            <div className="pt-2 border-t border-slate-100">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Audit Trail Log
              </h4>
              <ul className="max-h-52 space-y-1.5 overflow-y-auto text-xs text-slate-600">
                {auditTrail!.map((a) => (
                  <li key={a.id} className="rounded-lg bg-white border border-slate-200/80 p-2.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-800">{a.action}</p>
                      <span className="text-[11px] text-slate-400">{a.at}</span>
                    </div>
                    <p className="text-slate-500 mt-0.5">{a.by}</p>
                    {a.detail && (
                      <p className="text-slate-600 mt-0.5">{a.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advanced / Sensitive Audit Info (Admins Only) */}
          {(docHash || token || whSha || deptSha) && (
            <div className="pt-2 border-t border-slate-100">
              {isAdmin ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {advancedOpen ? "Hide Advanced Audit Information" : "Advanced Audit Information (Admin)"}
                  </button>

                  {advancedOpen && (
                    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                      {docHash && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-slate-400 font-mono text-[10px]">Document Hash:</span>
                            <p className="font-mono text-[11px] text-slate-700 truncate">{docHash}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy("dochash", docHash)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700"
                            title="Copy Document Hash"
                          >
                            {copiedKey === "dochash" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}

                      {token && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-slate-400 font-mono text-[10px]">Verification Token:</span>
                            <p className="font-mono text-[11px] text-slate-700 truncate">{token}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy("token", token)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700"
                            title="Copy Verification Token"
                          >
                            {copiedKey === "token" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}

                      {whSha && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-slate-400 font-mono text-[10px]">Warehouse Signature SHA256:</span>
                            <p className="font-mono text-[11px] text-slate-700 truncate">{whSha}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy("whSha", whSha)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700"
                            title="Copy Warehouse SHA256"
                          >
                            {copiedKey === "whSha" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}

                      {deptSha && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-slate-400 font-mono text-[10px]">Department Signature SHA256:</span>
                            <p className="font-mono text-[11px] text-slate-700 truncate">{deptSha}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy("deptSha", deptSha)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700"
                            title="Copy Department SHA256"
                          >
                            {copiedKey === "deptSha" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Lock className="h-3 w-3" />
                  <span>Digital cryptographic verification active. Technical hashes restricted to authorized audit administrators.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
