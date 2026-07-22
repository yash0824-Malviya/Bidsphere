import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Loader2,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";

import { createRfp, publishRfp, syncLocalRfpEnrichmentToErp } from "../../api/rfp";
import { saveRfpEnrichment } from "../../api/rfpStorage";
import { queryClient } from "../../queryClient";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import CategoryLinkField from "../../components/rfi/CategoryLinkField";
import RfiCollapsibleSection from "../../components/rfi/RfiCollapsibleSection";
import SupplierSelectionDialog, {
  type SelectedSupplier,
} from "../../components/rfi/SupplierSelectionDialog";
import RequiredDocumentsEditor, {
  createDefaultRfpDocuments,
  type RfpDocumentDraft,
} from "../../components/rfp/RequiredDocumentsEditor";
import { ErpNextDatePicker } from "../../components/ui";
import { useAuthStore } from "../../store/authStore";
import {
  RFP_CATEGORIES,
  RFP_DURATION_UNITS,
  type RfpDurationUnit,
} from "../../types/rfp";
import { isoDateOffset, todayIso } from "../../utils/format";
import { ownerTitleFromEmail } from "../../config/roles";

const DEPARTMENTS = [
  "Procurement",
  "Operations",
  "Engineering",
  "Manufacturing",
  "IT",
  "Finance",
  "Quality",
  "Logistics",
  "General",
];

function previewRfpNumber(): string {
  return `RFP-${new Date().getFullYear()}-#####`;
}

type SectionKey = "general" | "scope" | "documents" | "suppliers";

export default function NewRFPPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canPublish = user?.role === "procurement" || user?.role === "admin";

  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    general: true,
    scope: true,
    documents: true,
    suppliers: true,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(RFP_CATEGORIES[0]);
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [deadline, setDeadline] = useState(isoDateOffset(14));
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [businessObjective, setBusinessObjective] = useState("");
  const [technicalRequirements, setTechnicalRequirements] = useState("");
  const [durationValue, setDurationValue] = useState<number | "">(12);
  const [durationUnit, setDurationUnit] = useState<RfpDurationUnit>("Weeks");

  const [docs, setDocs] = useState<RfpDocumentDraft[]>(createDefaultRfpDocuments);
  const [selected, setSelected] = useState<Record<string, SelectedSupplier>>(
    {},
  );
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);

  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const selectedDocs = useMemo(
    () => docs.filter((d) => d.selected),
    [docs],
  );

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const removeSupplier = (name: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleCategoryChange = (next: string) => {
    setCategory(next);
    if (next) {
      toast(
        `Category “${next}” selected — use Add Suppliers for smart suggestions.`,
        { id: "rfp-category-hint", duration: 3200 },
      );
    }
  };

  const validateCommon = (): string | null => {
    if (!title.trim()) return "Title is required.";
    if (!category) return "Category is required.";
    if (!department) return "Department is required.";
    if (!deadline) return "Submission deadline is required.";
    if (deadline < todayIso()) {
      return "Submission Deadline cannot be in the past.";
    }
    if (!selectedList.length) {
      return "At least one Supplier is required.";
    }
    const ids = selectedList.map((s) => s.supplier.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      return "Duplicate suppliers are not allowed.";
    }
    if (!selectedDocs.length) {
      return "At least one Required Document is required.";
    }
    return null;
  };

  const buildApiPayload = () => ({
    title: title.trim(),
    description: description.trim(),
    submission_deadline: deadline,
    scope_of_work: scopeOfWork.trim(),
    business_objective: businessObjective.trim(),
    technical_requirements: technicalRequirements.trim(),
    required_documents: selectedDocs.map((d) => ({
      doc_type: d.doc_type,
      label: d.doc_type === "Other" ? d.label?.trim() || "Other" : undefined,
      required: d.required,
    })),
    suppliers: selectedList,
    owner: user?.email || user?.name,
  });

  const persistEnrichment = (
    rfpName: string,
    erpDocs?: Array<{
      id: string;
      doc_type: string;
      label?: string;
      required: boolean;
    }>,
  ) => {
    const docsForStore =
      erpDocs && erpDocs.length
        ? erpDocs.map((erp) => {
            const meta =
              selectedDocs.find(
                (d) =>
                  d.doc_type === erp.doc_type &&
                  (d.label || "") === (erp.label || ""),
              ) || selectedDocs.find((d) => d.doc_type === erp.doc_type);
            return {
              id: erp.id,
              doc_type: erp.doc_type as (typeof selectedDocs)[0]["doc_type"],
              label: erp.label,
              required: erp.required,
              max_file_size_mb: meta?.max_file_size_mb ?? 10,
              allowed_file_types: meta?.allowed_file_types ?? ["PDF"],
            };
          })
        : selectedDocs.map((d) => ({
            id: d.id,
            doc_type: d.doc_type,
            label:
              d.doc_type === "Other" ? d.label?.trim() || "Other" : undefined,
            required: d.required,
            max_file_size_mb: d.max_file_size_mb,
            allowed_file_types: d.allowed_file_types,
          }));

    saveRfpEnrichment(rfpName, {
      category,
      department,
      scope_of_work: scopeOfWork.trim(),
      business_objective: businessObjective.trim(),
      technical_requirements: technicalRequirements.trim(),
      estimated_duration_value:
        typeof durationValue === "number" ? durationValue : undefined,
      estimated_duration_unit: durationUnit,
      required_documents: docsForStore,
    });
  };

  const saveDraft = async () => {
    const err = validateCommon();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const doc = await createRfp(buildApiPayload());
      persistEnrichment(doc.name, doc.required_documents);
      try {
        await syncLocalRfpEnrichmentToErp(doc.name);
      } catch {
        /* non-blocking — create payload already includes narrative fields */
      }
      await queryClient.invalidateQueries({ queryKey: ["rfps"] });
      await queryClient.invalidateQueries({ queryKey: ["rfp-stats"] });
      toast.success(`${doc.name} saved as draft.`);
      navigate(`/sourcing/rfp/${encodeURIComponent(doc.name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save RFP.");
    } finally {
      setSaving(false);
    }
  };

  const saveAndPublish = async () => {
    if (!canPublish) {
      toast.error("Only Procurement Managers can publish RFPs.");
      return;
    }
    const err = validateCommon();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const doc = await createRfp(buildApiPayload());
      persistEnrichment(doc.name, doc.required_documents);
      try {
        await syncLocalRfpEnrichmentToErp(doc.name);
      } catch {
        /* non-blocking */
      }
      await publishRfp(doc.name);
      await queryClient.invalidateQueries({ queryKey: ["rfps"] });
      await queryClient.invalidateQueries({ queryKey: ["rfp-stats"] });
      toast.success(`${doc.name} published. Suppliers have been notified.`);
      navigate(`/sourcing/rfp/${encodeURIComponent(doc.name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish RFP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title="Create RFP"
        description="Request for Proposal — invite suppliers to submit structured proposals."
        actions={
          <Link
            to="/sourcing/rfp"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            All RFPs
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            RFP Number
          </p>
          <p className="font-mono text-sm font-semibold text-neutral-800">
            {previewRfpNumber()}
          </p>
          <p className="text-[11px] text-neutral-400">
            Auto-generated on save (e.g. RFP-2026-00001)
          </p>
        </div>
        <StatusBadge status="Draft" size="lg" />
        <div className="ml-auto text-right text-[12px] text-neutral-500">
          <p>
            Published By:{" "}
            <span className="font-medium text-neutral-700">
              {ownerTitleFromEmail(user?.email || user?.name) || "—"}
            </span>
          </p>
          <p className="text-neutral-400">Published On: — (after publish)</p>
        </div>
      </div>

      <RfiCollapsibleSection
        id="general"
        title="General Information"
        subtitle="Title, deadline, category and department"
        open={openSections.general}
        onToggle={() => toggleSection("general")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Title <span className="text-danger-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Packaging Line Automation Proposal"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief overview of the proposal request…"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Submission Deadline <span className="text-danger-500">*</span>
            </label>
            <ErpNextDatePicker
              value={deadline}
              onChange={setDeadline}
              min={todayIso()}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Department <span className="text-danger-500">*</span>
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <CategoryLinkField
              value={category}
              onChange={handleCategoryChange}
              categories={RFP_CATEGORIES}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Estimated Project Duration
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={durationValue}
                onChange={(e) =>
                  setDurationValue(
                    e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 1),
                  )
                }
                className="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
              />
              <select
                value={durationUnit}
                onChange={(e) =>
                  setDurationUnit(e.target.value as RfpDurationUnit)
                }
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
              >
                {RFP_DURATION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="scope"
        title="Scope & Objectives"
        subtitle="Scope of work, business objective and technical requirements"
        open={openSections.scope}
        onToggle={() => toggleSection("scope")}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Scope of Work
            </label>
            <textarea
              rows={5}
              value={scopeOfWork}
              onChange={(e) => setScopeOfWork(e.target.value)}
              placeholder="Describe the full scope of work expected from suppliers…"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Business Objective
            </label>
            <textarea
              rows={4}
              value={businessObjective}
              onChange={(e) => setBusinessObjective(e.target.value)}
              placeholder="What business outcome should this proposal achieve?"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Technical Requirements
            </label>
            <textarea
              rows={4}
              value={technicalRequirements}
              onChange={(e) => setTechnicalRequirements(e.target.value)}
              placeholder="Technical standards, integrations, compliance, or performance criteria…"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="documents"
        title="Required Documents"
        subtitle={`${selectedDocs.length} document(s) selected`}
        open={openSections.documents}
        onToggle={() => toggleSection("documents")}
        badge={
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {selectedDocs.length}
          </span>
        }
      >
        <RequiredDocumentsEditor docs={docs} onChange={setDocs} />
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="suppliers"
        title="Suppliers"
        subtitle="Invite suppliers to submit proposals"
        open={openSections.suppliers}
        onToggle={() => toggleSection("suppliers")}
        badge={
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
            {selectedList.length}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-[#64748B]">
              {category
                ? `Smart suggestions will prefer suppliers matching “${category}”.`
                : "Select a category to enable smart supplier suggestions."}
            </p>
            <button
              type="button"
              onClick={() => setSupplierDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <UserPlus className="h-4 w-4" />
              Add Suppliers
            </button>
          </div>

          {selectedList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500">
              No suppliers selected yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <tr>
                    <th className="px-3 py-2.5">Supplier Name</th>
                    <th className="px-3 py-2.5">ID</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {selectedList.map((s) => (
                    <tr key={s.supplier}>
                      <td className="px-3 py-2.5 font-medium text-neutral-900">
                        {s.supplier_name}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-neutral-500">
                        {s.supplier}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeSupplier(s.supplier)}
                          className="inline-flex items-center gap-1 text-[12px] text-danger-600 hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RfiCollapsibleSection>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveDraft()}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save as Draft
          </button>
          {canPublish ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAndPublish()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Publish RFP
            </button>
          ) : null}
        </div>
      </div>

      <SupplierSelectionDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        selected={selected}
        onApply={setSelected}
        categoryHint={category}
      />
    </div>
  );
}
