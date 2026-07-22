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

import { createRfi, publishRfi } from "../../api/rfi";
import { queryClient } from "../../queryClient";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import CategoryLinkField from "../../components/rfi/CategoryLinkField";
import QuestionnaireBuilder, {
  createEmptyQuestion,
  type QuestionDraft,
} from "../../components/rfi/QuestionnaireBuilder";
import RequiredDocumentsEditor, {
  createDefaultDocuments,
  type DocumentDraft,
} from "../../components/rfi/RequiredDocumentsEditor";
import RfiCollapsibleSection from "../../components/rfi/RfiCollapsibleSection";
import SupplierSelectionDialog, {
  type SelectedSupplier,
} from "../../components/rfi/SupplierSelectionDialog";
import { ErpNextDatePicker } from "../../components/ui";
import { useAuthStore } from "../../store/authStore";
import { RFI_CATEGORIES } from "../../types/rfi";
import { isoDateOffset, todayIso } from "../../utils/format";

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

function previewRfiNumber(): string {
  return `RFI-${new Date().getFullYear()}-#####`;
}

type SectionKey = "general" | "questions" | "documents" | "suppliers";

export default function NewRFIPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    general: true,
    questions: true,
    documents: true,
    suppliers: true,
  });

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(RFI_CATEGORIES[0]);
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(isoDateOffset(14));

  const [questions, setQuestions] = useState<QuestionDraft[]>([
    createEmptyQuestion(),
  ]);
  const [docs, setDocs] = useState<DocumentDraft[]>(createDefaultDocuments);

  const [selected, setSelected] = useState<Record<string, SelectedSupplier>>(
    {},
  );
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const filledQuestions = useMemo(
    () => questions.filter((q) => q.title.trim()),
    [questions],
  );
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
    if (next && selectedList.length === 0) {
      toast(
        `Category “${next}” selected — use Add Suppliers for smart suggestions.`,
        { id: "rfi-category-hint", duration: 3200 },
      );
    }
  }

  const validateForPublish = (): string | null => {
    if (!title.trim()) return "Title is required.";
    if (!category) return "Category is required.";
    if (!department) return "Department is required.";
    if (!deadline) return "Submission deadline is required.";
    if (deadline < todayIso()) {
      return "Submission Deadline cannot be in the past.";
    }
    if (!filledQuestions.length) {
      return "At least one Question is required.";
    }
    for (const q of filledQuestions) {
      if (
        (q.type === "dropdown" || q.type === "checkbox") &&
        q.options.filter((o) => o.trim()).length < 2
      ) {
        return `"${q.title}" needs at least two options.`;
      }
    }
    if (!selectedList.length) {
      return "At least one Supplier is required before publishing.";
    }
    const ids = selectedList.map((s) => s.supplier.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      return "Duplicate suppliers are not allowed.";
    }
    return null;
  };

  const validateForDraft = (): string | null => {
    if (!title.trim()) return "Title is required to save a draft.";
    if (!category) return "Category is required.";
    if (!department) return "Department is required.";
    if (!deadline) return "Submission deadline is required.";
    if (deadline < todayIso()) {
      return "Submission Deadline cannot be in the past.";
    }
    if (!selectedList.length) return "Select at least one supplier to save.";
    const ids = selectedList.map((s) => s.supplier.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      return "Duplicate suppliers are not allowed.";
    }
    return null;
  };

  const buildPayload = () => ({
    title: title.trim(),
    category,
    department,
    description: description.trim(),
    submission_deadline: deadline,
    questions: filledQuestions.map((q) => ({
      title: q.title.trim(),
      type: q.type,
      required: q.required,
      options: q.options,
      placeholder: q.placeholder,
      help_text: q.help_text,
    })),
    required_documents: selectedDocs.map((d) => ({
      doc_type: d.doc_type,
      label:
        d.doc_type === "Other"
          ? d.label?.trim() || "Other"
          : undefined,
      required: d.required,
      max_file_size_mb: d.max_file_size_mb,
      allowed_file_types: d.allowed_file_types,
    })),
    suppliers: selectedList,
    owner: user?.email || user?.name,
  });

  const saveDraft = async () => {
    const err = validateForDraft();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const doc = await createRfi(buildPayload());
      await queryClient.invalidateQueries({ queryKey: ["rfis"] });
      await queryClient.invalidateQueries({ queryKey: ["rfi-stats"] });
      toast.success(`${doc.name} saved as draft.`);
      navigate(`/sourcing/rfi/${encodeURIComponent(doc.name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save RFI.");
    } finally {
      setSaving(false);
    }
  };

  const saveAndPublish = async () => {
    const err = validateForPublish();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const doc = await createRfi(buildPayload());
      await publishRfi(doc.name);
      await queryClient.invalidateQueries({ queryKey: ["rfis"] });
      await queryClient.invalidateQueries({ queryKey: ["rfi-stats"] });
      toast.success(`${doc.name} published. Suppliers have been notified.`);
      navigate(`/sourcing/rfi/${encodeURIComponent(doc.name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish RFI.");
    } finally {
      setSaving(false);
    }
  };

  const publishedByPreview = user?.email || user?.name || "Current user";

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Create RFI"
        description="Enterprise Request for Information — collect supplier capabilities before RFQ."
        actions={
          <Link
            to="/sourcing/rfi"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Link>
        }
      />

      {/* Sticky enterprise header summary */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              RFI Number
            </p>
            <p className="font-mono text-[13px] font-semibold text-neutral-800">
              {previewRfiNumber()}
            </p>
          </div>
          <StatusBadge status="Draft" size="lg" />
          <div className="h-8 w-px bg-neutral-100" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Deadline
            </p>
            <p className="text-[13px] font-medium text-neutral-800">
              {deadline || "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Category
            </p>
            <p className="text-[13px] font-medium text-neutral-800">
              {category || "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Department
            </p>
            <p className="text-[13px] font-medium text-neutral-800">
              {department || "—"}
            </p>
          </div>
        </div>
      </div>

      <RfiCollapsibleSection
        id="general"
        title="1. General Information"
        subtitle="Core RFI details used across procurement and the supplier portal."
        open={openSections.general}
        onToggle={() => toggleSection("general")}
        badge={<StatusBadge status="Draft" size="sm" />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              RFI Number
            </span>
            <input
              type="text"
              readOnly
              value={previewRfiNumber()}
              className="w-full cursor-not-allowed rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-600"
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              Auto-generated on save as RFI-YYYY-00001 (readonly).
            </span>
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Title <span className="text-danger-500">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Packaging Materials Capability Survey"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </label>

          <CategoryLinkField
            value={category}
            onChange={handleCategoryChange}
            required
          />

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Department <span className="text-danger-500">*</span>
            </span>
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
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Submission Deadline <span className="text-danger-500">*</span>
            </span>
            <ErpNextDatePicker value={deadline} onChange={setDeadline} />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Description
            </span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the information you need from suppliers…"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </label>

          <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">
                Published By
              </span>
              <input
                type="text"
                readOnly
                value={publishedByPreview}
                className="w-full cursor-not-allowed rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">
                Published On
              </span>
              <input
                type="text"
                readOnly
                value="Set automatically on Publish"
                className="w-full cursor-not-allowed rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500"
              />
            </label>
          </div>
        </div>
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="questions"
        title="2. Questions"
        subtitle="Dynamic questionnaire for invited suppliers."
        open={openSections.questions}
        onToggle={() => toggleSection("questions")}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {filledQuestions.length}
          </span>
        }
      >
        <QuestionnaireBuilder questions={questions} onChange={setQuestions} />
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="documents"
        title="3. Required Documents"
        subtitle="Document checklist with file rules for suppliers."
        open={openSections.documents}
        onToggle={() => toggleSection("documents")}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {selectedDocs.length}
          </span>
        }
      >
        <RequiredDocumentsEditor docs={docs} onChange={setDocs} />
      </RfiCollapsibleSection>

      <RfiCollapsibleSection
        id="suppliers"
        title="4. Suppliers"
        subtitle="Invite suppliers via the selection dialog. Duplicates are blocked."
        open={openSections.suppliers}
        onToggle={() => toggleSection("suppliers")}
        badge={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {selectedList.length}
          </span>
        }
      >
        <div className="space-y-3">
          {category ? (
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2 text-[12px] text-[#0C4A6E]">
              Smart suggestion ready for category <strong>{category}</strong>.
              Click <strong>Add Suppliers</strong> to review and apply matches.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSupplierDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <UserPlus className="h-4 w-4" />
              Add Suppliers
            </button>
            <p className="text-[12px] text-neutral-500">
              {selectedList.length
                ? `${selectedList.length} supplier(s) invited`
                : "No suppliers selected yet"}
            </p>
          </div>

          {selectedList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
              Use Add Suppliers to search, filter, and invite suppliers.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[#F8FAFC]">
                  <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5">Supplier ID</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {selectedList.map((s) => (
                    <tr key={s.supplier}>
                      <td className="px-3 py-2.5 font-medium text-neutral-900">
                        {s.supplier_name}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500">
                        {s.supplier}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeSupplier(s.supplier)}
                          className="inline-flex items-center gap-1 text-danger-600 hover:underline"
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

      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
        <p className="text-[12px] text-neutral-500">
          Publish sets status to <strong>Published</strong>, records Published
          On, and notifies invited suppliers.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={saveDraft}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save as Draft
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={saveAndPublish}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Publish RFI
          </button>
        </div>
      </div>

      <SupplierSelectionDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        selected={selected}
        categoryHint={category}
        onApply={setSelected}
      />
    </div>
  );
}
