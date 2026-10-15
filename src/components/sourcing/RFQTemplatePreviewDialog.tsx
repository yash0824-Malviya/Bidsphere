import {
  AlertCircle,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileText,
  Layers,
  Package,
  Play,
  Pencil,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { RFQTemplate } from "../../types/erpnext";
import StatusBadge from "../StatusBadge";
import { formatCurrency } from "../../utils/format";
import { getCategoryAvailability } from "../../api/rfqTemplatePopulation";

interface Props {
  template: RFQTemplate | null;
  onClose: () => void;
  onCreateRFQ: (template: RFQTemplate) => void;
  onEdit: (template: RFQTemplate) => void;
}

export default function RFQTemplatePreviewDialog({
  template,
  onClose,
  onCreateRFQ,
  onEdit,
}: Props) {
  if (!template) return null;

  const availability = getCategoryAvailability(template);
  const items = template.items ?? [];
  const suppliers = template.suppliers ?? [];
  const requiredDocs = template.required_documents;
  const workflowRules = template.workflow_rules;

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay">
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="modal-panel relative flex max-h-[92vh] w-full max-w-4xl flex-col p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-neutral-900">
                  {template.template_name}
                </h2>
                <StatusBadge status={template.status} />
              </div>
              <p className="mt-0.5 text-xs text-neutral-500">
                {template.category} • {template.procurement_type ?? "Direct"} Procurement
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
              <span className="text-xs font-medium text-neutral-500">Procurement Type</span>
              <p className="mt-1 font-semibold text-neutral-800">
                {template.procurement_type ?? "Direct"}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
              <span className="text-xs font-medium text-neutral-500">Category</span>
              <p className="mt-1 font-semibold text-neutral-800 truncate" title={template.category}>
                {template.category}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
              <span className="text-xs font-medium text-neutral-500">Cost Breakdown</span>
              <p className="mt-1 font-semibold text-neutral-800">
                {template.cost_breakdown_required ? "Required" : "Optional"}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
              <span className="text-xs font-medium text-neutral-500">Contract Required</span>
              <p className="mt-1 font-semibold text-neutral-800">
                {template.contract_required ? "Yes" : "No"}
              </p>
            </div>
          </div>

          {/* Description */}
          {template.description && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Description & Scope
              </h3>
              <p className="rounded-lg border border-neutral-200 bg-white p-3 text-neutral-700 text-xs leading-relaxed">
                {template.description}
              </p>
            </div>
          )}

          {/* Items Section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                <Package className="h-4 w-4 text-neutral-400" />
                Template Items ({items.length})
              </h3>
            </div>

            {!availability.hasData ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  No matching Item Master records found in ERP
                </div>
                <p className="mt-1 text-amber-700">
                  {availability.message || "You can configure items manually when creating the RFQ."}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
                  <thead className="bg-neutral-50 font-medium text-neutral-600">
                    <tr>
                      <th className="px-3 py-2">Item Code</th>
                      <th className="px-3 py-2">Item Description</th>
                      <th className="px-3 py-2 text-right">Default Qty</th>
                      <th className="px-3 py-2">UOM</th>
                      <th className="px-3 py-2">Specification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {items.map((it, idx) => (
                      <tr key={it.item_code + idx} className="hover:bg-neutral-50/50">
                        <td className="px-3 py-2 font-mono font-medium text-neutral-900">
                          {it.item_code}
                        </td>
                        <td className="px-3 py-2 text-neutral-800">
                          {it.item_name || it.description || it.item_code}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                          {it.qty ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">{it.uom || "Nos"}</td>
                        <td className="px-3 py-2 text-neutral-500 truncate max-w-xs">
                          {it.specification || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Suppliers Section */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <Building2 className="h-4 w-4 text-neutral-400" />
              Suggested Eligible Suppliers ({suppliers.length})
            </h3>
            {suppliers.length === 0 ? (
              <p className="text-xs text-neutral-500">No suggested suppliers configured.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {suppliers.map((s) => (
                  <div
                    key={s.supplier}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <div>
                        <p className="font-medium text-neutral-900">{s.supplier_name || s.supplier}</p>
                        <p className="text-[11px] text-neutral-500">Active Master Record</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Supplier Terms & Conditions */}
          {template.supplier_terms && (
            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                <FileText className="h-4 w-4 text-neutral-400" />
                Supplier Terms & Conditions
              </h3>
              <pre className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 font-sans text-xs whitespace-pre-wrap text-neutral-700">
                {template.supplier_terms}
              </pre>
            </div>
          )}

          {/* Governance & Approvals */}
          <div className="grid gap-4 sm:grid-cols-2">
            {requiredDocs && (
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 mb-2">
                  <FileCheck2 className="h-3.5 w-3.5 text-primary-600" />
                  Required Supplier Documents
                </h4>
                <ul className="space-y-1 text-xs text-neutral-600">
                  <li className="flex items-center gap-2">
                    <span className={requiredDocs.terms_and_conditions ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Terms & Conditions
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={requiredDocs.warranty_certificate ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Warranty Certificate
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={requiredDocs.insurance_certificate ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Insurance Certificate
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={requiredDocs.nda ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Non-Disclosure Agreement (NDA)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={requiredDocs.compliance_certificate ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Compliance Certificate
                  </li>
                </ul>
              </div>
            )}

            {workflowRules && (
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 mb-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary-600" />
                  Workflow Approval Gates
                </h4>
                <ul className="space-y-1 text-xs text-neutral-600">
                  <li className="flex items-center gap-2">
                    <span className={workflowRules.budget_approval_required ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Budget Approval Required
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={workflowRules.legal_review_required ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Legal Review Required
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={workflowRules.finance_review_required ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Finance Review Required
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={workflowRules.management_approval_required ? "text-emerald-600" : "text-neutral-300"}>●</span>
                    Management Approval Required
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onEdit(template);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit Template
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Close
            </button>
            {template.status === "Active" ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCreateRFQ(template);
                }}
                className="btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5" />
                Create RFQ from Template
              </button>
            ) : (
              <span className="text-xs italic text-neutral-500">
                Template is inactive. Activate it to create RFQs.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
