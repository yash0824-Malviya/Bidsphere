import React, { useState } from "react";
import { X, Sparkles, Plus, Trash2 } from "lucide-react";
import type { BusinessCase } from "../../types/businessIntake";
import { formatCurrency } from "../../utils/format";

interface Props {
  isOpen: boolean;
  businessCase: BusinessCase | null;
  onClose: () => void;
  onSubmit: (rfqData: {
    title: string;
    target_suppliers: string[];
    valid_till: string;
    procurement_category: string;
    supplier_terms: string;
    items: Array<{
      item_code: string;
      item_name: string;
      description: string;
      qty: number;
      uom: string;
      target_price?: number;
    }>;
  }) => Promise<void>;
}

export function CreateRFQFromBusinessCaseModal({
  isOpen,
  businessCase,
  onClose,
  onSubmit,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  const [rfqTitle, setRfqTitle] = useState("");
  const [procurementCategory, setProcurementCategory] = useState("Direct Procurement");
  const [validTill, setValidTill] = useState(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [suppliersInput, setSuppliersInput] = useState("");
  const [supplierTerms, setSupplierTerms] = useState(
    "Standard Netlink Commercial Terms apply. Delivery to Plant 01 within 45 days. Minimum 24-month warranty."
  );

  const [items, setItems] = useState<
    Array<{
      item_code: string;
      item_name: string;
      description: string;
      qty: number;
      uom: string;
      target_price?: number;
    }>
  >([]);

  React.useEffect(() => {
    if (!businessCase) return;

    setRfqTitle(`RFQ: ${businessCase.title}`);
    setSuppliersInput(businessCase.target_suppliers || "ABB Robotics, KUKA Automation, Fanuc Corp");

    if (businessCase.technical_requirements_list && businessCase.technical_requirements_list.length > 0) {
      const mapped = businessCase.technical_requirements_list.map((tr, idx) => ({
        item_code: tr.item_code || `TR-ITEM-${String(idx + 1).padStart(3, "0")}`,
        item_name: tr.requirement_type ? `${tr.requirement_type}: ${tr.specification.slice(0, 45)}` : (tr.description || businessCase.title),
        description: `${tr.specification || tr.description || ""}${tr.performance_requirements ? `\nPerformance: ${tr.performance_requirements}` : ""}${tr.quality_requirements ? `\nQuality: ${tr.quality_requirements}` : ""}${tr.safety_compliance_requirements ? `\nSafety/Compliance: ${tr.safety_compliance_requirements}` : ""}`,
        qty: tr.quantity || 1,
        uom: tr.uom || "Nos.",
        target_price: idx === 0 ? businessCase.budget : undefined,
      }));
      setItems(mapped);
    } else {
      setItems([
        {
          item_code: "INT-ROB-001",
          item_name: businessCase.title || "Equipment / Service Request",
          description: businessCase.technical_requirements || "Detailed specifications per business case.",
          qty: 1,
          uom: "Unit",
          target_price: businessCase.budget || 100000,
        },
      ]);
    }
  }, [businessCase]);

  if (!isOpen || !businessCase) return null;

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        item_code: `ITEM-00${prev.length + 1}`,
        item_name: "Additional Component / Service Item",
        description: "Specify technical requirement details...",
        qty: 1,
        uom: "Unit",
        target_price: 10000,
      },
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rfqTitle.trim()) return;

    try {
      setSubmitting(true);
      const suppliersList = suppliersInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await onSubmit({
        title: rfqTitle,
        target_suppliers: suppliersList,
        valid_till: validTill,
        procurement_category: procurementCategory,
        supplier_terms: supplierTerms,
        items,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral-900/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl rounded-2xl border border-neutral-200 bg-white shadow-2xl transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900">
                Create Sourcing RFQ from Business Case
              </h2>
              <p className="text-xs text-neutral-500">
                Pre-populating technical requirements and financial allocations from {businessCase.business_case_id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto p-6 space-y-6">
          {/* Pre-populated Case Summary Box */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase text-neutral-600 border-b border-neutral-200 pb-1.5 flex items-center justify-between">
              <span>Source Business Case &amp; Inherited Technical Parameters</span>
              <span className="text-[10.5px] font-normal text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Approved Specifications Carried Forward
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 text-xs">
              <div>
                <span className="text-neutral-500 block">Business Need</span>
                <span className="font-mono font-bold text-neutral-800">{businessCase.business_need_id}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Business Case</span>
                <span className="font-mono font-bold text-primary-700">{businessCase.business_case_id}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Department</span>
                <span className="font-semibold text-neutral-800">{businessCase.department}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Approved Budget</span>
                <span className="font-bold text-emerald-700">{formatCurrency(businessCase.budget)}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Tech Line Items</span>
                <span className="font-bold text-indigo-700">
                  {businessCase.technical_requirements_list?.length || 1} Item(s)
                </span>
              </div>
            </div>

            {/* Read-only technical requirements preview */}
            {businessCase.technical_requirements_list && businessCase.technical_requirements_list.length > 0 && (
              <div className="pt-2 border-t border-neutral-200/80">
                <span className="text-[11px] font-bold text-neutral-700 uppercase block mb-1">
                  Approved Technical Specifications (Read-Only)
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {businessCase.technical_requirements_list.map((tr, idx) => (
                    <div key={idx} className="rounded-md border border-neutral-200 bg-white p-2 text-[11.5px]">
                      <div className="flex items-center justify-between font-semibold text-neutral-900">
                        <span>{idx + 1}. [{tr.requirement_type}] {tr.specification}</span>
                        <span className="font-mono text-neutral-600">{tr.quantity} {tr.uom}</span>
                      </div>
                      {tr.performance_requirements && (
                        <p className="text-[11px] text-neutral-500 mt-0.5">Perf: {tr.performance_requirements}</p>
                      )}
                      {tr.required_supplier_documents && tr.required_supplier_documents.length > 0 && (
                        <p className="text-[10.5px] text-indigo-600 mt-0.5 font-medium">
                          Required Docs: {tr.required_supplier_documents.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RFQ Header Controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold uppercase text-neutral-600">
                RFQ Title *
              </label>
              <input
                type="text"
                required
                value={rfqTitle}
                onChange={(e) => setRfqTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-neutral-600">
                Valid Till Date *
              </label>
              <input
                type="date"
                required
                value={validTill}
                onChange={(e) => setValidTill(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Procurement Category & Target Suppliers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase text-neutral-600">
                Procurement Category
              </label>
              <select
                value={procurementCategory}
                onChange={(e) => setProcurementCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="Direct Procurement">Direct Procurement</option>
                <option value="Indirect Procurement">Indirect Procurement</option>
                <option value="Capital Equipment">Capital Equipment (CAPEX)</option>
                <option value="IT Hardware & Software">IT Hardware & Software</option>
                <option value="MRO & Tools">MRO & Industrial Tools</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-neutral-600">
                Target Suppliers (Comma Separated)
              </label>
              <input
                type="text"
                value={suppliersInput}
                onChange={(e) => setSuppliersInput(e.target.value)}
                placeholder="e.g. Supplier A, Supplier B, Supplier C"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase text-neutral-600">
                RFQ Line Items (Mapped from Technical Specs)
              </label>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item Line
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-neutral-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                  <tr>
                    <th className="p-3">Item Code</th>
                    <th className="p-3">Item Name</th>
                    <th className="p-3">Qty</th>
                    <th className="p-3">UOM</th>
                    <th className="p-3">Target Price ($)</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.item_code}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, item_code: val } : it))
                            );
                          }}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.item_name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, item_name: val } : it))
                            );
                          }}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs font-semibold"
                        />
                      </td>
                      <td className="p-2 w-20">
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, qty: val } : it))
                            );
                          }}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-2 w-24">
                        <input
                          type="text"
                          value={item.uom}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, uom: val } : it))
                            );
                          }}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-2 w-32">
                        <input
                          type="number"
                          value={item.target_price || ""}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, target_price: val } : it))
                            );
                          }}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs font-bold"
                        />
                      </td>
                      <td className="p-2 text-right">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Terms & Instructions for Suppliers */}
          <div>
            <label className="block text-xs font-semibold uppercase text-neutral-600">
              Message / Commercial Terms for Bidding Suppliers
            </label>
            <textarea
              rows={3}
              value={supplierTerms}
              onChange={(e) => setSupplierTerms(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-neutral-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {submitting ? "Generating RFQ..." : "Create RFQ Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
