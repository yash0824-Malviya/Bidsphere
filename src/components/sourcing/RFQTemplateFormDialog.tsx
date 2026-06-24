import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ClipboardList,
  FileCheck2,
  GitBranch,
  Package,
  Plus,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { apiGet } from "../../api/erpnext";
import {
  RFQ_TEMPLATE_CATEGORIES,
  RFQ_TEMPLATE_RFQ_TYPES,
  type RFQTemplateInput,
} from "../../api/rfqTemplates";
import type {
  RFQTemplate,
  RFQTemplateRequiredDocuments,
  RFQTemplateWorkflowRules,
  Supplier,
} from "../../types/erpnext";
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  DEFAULT_WORKFLOW_RULES,
} from "../../types/erpnext";
import { generateId } from "../../utils/id";

type FormItem = {
  id: string;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  target_price: number;
  specification: string;
};

type FormSupplier = { supplier: string; supplier_name: string };

const emptyItem = (): FormItem => ({
  id: generateId(),
  item_code: "",
  item_name: "",
  qty: 1,
  uom: "Nos",
  target_price: 0,
  specification: "",
});

interface Props {
  mode: "create" | "edit" | "duplicate";
  template: RFQTemplate | null;
  onClose: () => void;
  onSave: (data: RFQTemplateInput) => void;
  isSaving: boolean;
}

export default function RFQTemplateFormDialog({
  mode,
  template,
  onClose,
  onSave,
  isSaving,
}: Props) {
  const prefill = mode !== "create" && template;

  const [templateName, setTemplateName] = useState(
    prefill
      ? mode === "duplicate"
        ? `${template!.template_name} (Copy)`
        : template!.template_name
      : ""
  );
  const [category, setCategory] = useState(
    prefill ? template!.category : RFQ_TEMPLATE_CATEGORIES[0]
  );
  const [rfqType, setRfqType] = useState(
    prefill ? template!.rfq_type ?? "Standard RFQ" : "Standard RFQ"
  );
  const [description, setDescription] = useState(
    prefill ? template!.description ?? "" : ""
  );
  const [estimatedValue, setEstimatedValue] = useState(
    prefill ? template!.estimated_value ?? 0 : 0
  );
  const [items, setItems] = useState<FormItem[]>(() =>
    prefill && template!.items?.length
      ? template!.items.map((i) => ({
          id: generateId(),
          item_code: i.item_code,
          item_name: i.item_name ?? "",
          qty: i.qty ?? 1,
          uom: i.uom ?? "Nos",
          target_price: i.target_price ?? 0,
          specification: i.specification ?? "",
        }))
      : [emptyItem()]
  );
  const [suppliers, setSuppliers] = useState<FormSupplier[]>(() =>
    prefill
      ? (template!.suppliers ?? []).map((s) => ({
          supplier: s.supplier,
          supplier_name: s.supplier_name ?? s.supplier,
        }))
      : []
  );
  const [requiredDocs, setRequiredDocs] = useState<RFQTemplateRequiredDocuments>(
    prefill
      ? { ...DEFAULT_REQUIRED_DOCUMENTS, ...template!.required_documents }
      : { ...DEFAULT_REQUIRED_DOCUMENTS }
  );
  const [workflowRules, setWorkflowRules] = useState<RFQTemplateWorkflowRules>(
    prefill
      ? { ...DEFAULT_WORKFLOW_RULES, ...template!.workflow_rules }
      : { ...DEFAULT_WORKFLOW_RULES }
  );
  const [supplierSearch, setSupplierSearch] = useState("");

  const suppliersQuery = useQuery<Supplier[]>({
    queryKey: ["template-supplier-search", supplierSearch],
    queryFn: () => {
      const filters: Array<[string, string, string]> = [["disabled", "=", "0"]];
      if (supplierSearch.trim()) {
        filters.push(["supplier_name", "like", `%${supplierSearch.trim()}%`]);
      }
      return apiGet<Supplier[]>("/api/resource/Supplier", {
        params: {
          filters: JSON.stringify(filters),
          fields: JSON.stringify(["name", "supplier_name", "supplier_group"]),
          limit_page_length: 20,
        },
      });
    },
    staleTime: 30_000,
  });

  const availableSuppliers = useMemo(() => {
    const selected = new Set(suppliers.map((s) => s.supplier));
    return (suppliersQuery.data ?? []).filter((s) => !selected.has(s.name));
  }, [suppliersQuery.data, suppliers]);

  const title =
    mode === "create"
      ? "Create RFQ Template"
      : mode === "edit"
        ? "Edit RFQ Template"
        : "Clone RFQ Template";

  const addSupplier = useCallback((s: Supplier) => {
    setSuppliers((prev) => {
      if (prev.some((p) => p.supplier === s.name)) return prev;
      return [
        ...prev,
        { supplier: s.name, supplier_name: s.supplier_name ?? s.name },
      ];
    });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) {
      toast.error("Template name is required");
      return;
    }
    const validItems = items.filter((i) => i.item_code.trim());
    if (!validItems.length) {
      toast.error("Add at least one item with an item code");
      return;
    }
    if (!suppliers.length) {
      toast.error("Select at least one preferred supplier");
      return;
    }

    onSave({
      template_name: templateName.trim(),
      category,
      rfq_type: rfqType,
      description,
      estimated_value: estimatedValue,
      status: "Active",
      items: validItems.map((i) => ({
        item_code: i.item_code.trim(),
        item_name: i.item_name.trim() || i.item_code.trim(),
        qty: i.qty,
        uom: i.uom || "Nos",
        target_price: i.target_price,
        specification: i.specification,
      })),
      suppliers,
      required_documents: requiredDocs,
      workflow_rules: workflowRules,
    });
  }

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay">
      <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="modal-panel relative flex max-h-[92vh] w-full max-w-4xl flex-col p-0">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
            <p className="text-xs text-neutral-500">Enterprise procurement RFQ template configuration</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100" aria-label="Close">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <Section icon={ClipboardList} title="1. Basic Information">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template Name" required>
                  <input className="input-field" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. IT Hardware Standard" required />
                </Field>
                <Field label="Category" required>
                  <select className="select-field" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                    {RFQ_TEMPLATE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="RFQ Type" required>
                  <select className="select-field" value={rfqType} onChange={(e) => setRfqType(e.target.value as typeof rfqType)}>
                    {RFQ_TEMPLATE_RFQ_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Estimated Value">
                  <input type="number" min={0} step={0.01} className="input-field" value={estimatedValue || ""} onChange={(e) => setEstimatedValue(parseFloat(e.target.value) || 0)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Description">
                    <textarea className="input-field min-h-[72px]" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Purpose, scope, and procurement notes…" />
                  </Field>
                </div>
              </div>
            </Section>

            <Section icon={Package} title="2. Item Templates"
              action={
                <button type="button" onClick={() => setItems((p) => [...p, emptyItem()])} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700">
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </button>
              }
            >
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={item.id} className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-500">Item {idx + 1}</span>
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems((p) => p.filter((x) => x.id !== item.id))} className="text-neutral-400 hover:text-danger-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      <input className="input-field text-xs" placeholder="Item Code *" value={item.item_code} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, item_code: e.target.value } : x))} />
                      <input className="input-field text-xs sm:col-span-2" placeholder="Item Name" value={item.item_name} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, item_name: e.target.value } : x))} />
                      <input type="number" min={1} className="input-field text-xs" placeholder="Qty" value={item.qty} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, qty: Number(e.target.value) || 1 } : x))} />
                      <input className="input-field text-xs" placeholder="UOM" value={item.uom} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, uom: e.target.value } : x))} />
                      <input type="number" min={0} step={0.01} className="input-field text-xs" placeholder="Target Price" value={item.target_price || ""} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, target_price: parseFloat(e.target.value) || 0 } : x))} />
                    </div>
                    <input className="input-field mt-2 text-xs" placeholder="Specification / technical requirements" value={item.specification} onChange={(e) => setItems((p) => p.map((x) => x.id === item.id ? { ...x, specification: e.target.value } : x))} />
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Users} title="3. Supplier Templates">
              <input className="input-field mb-2" placeholder="Search suppliers to add…" value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} />
              {availableSuppliers.length > 0 && (
                <div className="mb-3 max-h-32 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                  {availableSuppliers.map((s) => (
                    <button key={s.name} type="button" onClick={() => addSupplier(s)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-primary-50">
                      <span>{s.supplier_name ?? s.name}</span>
                      <Plus className="h-3.5 w-3.5 text-primary-600" />
                    </button>
                  ))}
                </div>
              )}
              {suppliers.length === 0 ? (
                <p className="text-xs text-neutral-500">No preferred suppliers selected yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suppliers.map((s) => (
                    <span key={s.supplier} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800">
                      {s.supplier_name}
                      <button type="button" onClick={() => setSuppliers((p) => p.filter((x) => x.supplier !== s.supplier))} className="text-primary-500 hover:text-danger-600">×</button>
                    </span>
                  ))}
                </div>
              )}
            </Section>

            <Section icon={FileCheck2} title="4. Required Documents">
              <div className="grid gap-2 sm:grid-cols-2">
                <DocToggle label="Terms & Conditions" checked={requiredDocs.terms_and_conditions} onChange={(v) => setRequiredDocs((d) => ({ ...d, terms_and_conditions: v }))} />
                <DocToggle label="Warranty Certificate" checked={requiredDocs.warranty_certificate} onChange={(v) => setRequiredDocs((d) => ({ ...d, warranty_certificate: v }))} />
                <DocToggle label="Insurance Certificate" checked={requiredDocs.insurance_certificate} onChange={(v) => setRequiredDocs((d) => ({ ...d, insurance_certificate: v }))} />
                <DocToggle label="NDA" checked={requiredDocs.nda} onChange={(v) => setRequiredDocs((d) => ({ ...d, nda: v }))} />
                <DocToggle label="Compliance Certificate" checked={requiredDocs.compliance_certificate} onChange={(v) => setRequiredDocs((d) => ({ ...d, compliance_certificate: v }))} />
              </div>
            </Section>

            <Section icon={GitBranch} title="5. Workflow Rules">
              <div className="space-y-2">
                <WorkflowToggle label="Budget Approval Required" checked={workflowRules.budget_approval_required} onChange={(v) => setWorkflowRules((r) => ({ ...r, budget_approval_required: v }))} />
                <WorkflowToggle label="Legal Review Required" checked={workflowRules.legal_review_required} onChange={(v) => setWorkflowRules((r) => ({ ...r, legal_review_required: v }))} />
                <WorkflowToggle label="Finance Review Required" checked={workflowRules.finance_review_required} onChange={(v) => setWorkflowRules((r) => ({ ...r, finance_review_required: v }))} />
                <WorkflowToggle label="Management Approval Required" checked={workflowRules.management_approval_required ?? false} onChange={(v) => setWorkflowRules((r) => ({ ...r, management_approval_required: v }))} />
              </div>
            </Section>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 px-6 py-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={isSaving} className="btn-touch rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn-touch rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60">
              {isSaving ? "Saving…" : mode === "edit" ? "Save Template" : "Create Template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children, action }: { icon: typeof ClipboardList; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-field">{label}{required && <span className="text-danger"> *</span>}</label>
      {children}
    </div>
  );
}

function DocToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
      {label}
    </label>
  );
}

function WorkflowToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5 text-sm hover:bg-neutral-50">
      <span className="font-medium text-neutral-800">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
    </label>
  );
}
