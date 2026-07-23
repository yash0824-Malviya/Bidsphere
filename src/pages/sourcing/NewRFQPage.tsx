import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Layers,
  LayoutTemplate,
  Loader2,
  Lock,
  Package,
  PenLine,
  Plus,
  Search,
  Send,
  Users,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";

import { apiGet, ENV_DEFAULTS } from "../../api/erpnext";
import { queryClient } from "../../queryClient";
import { createRFQ, getItemGroups, updateRFQ } from "../../api/sourcing";
import {
  ActiveRfqExistsError,
  buildRFQPrefillFromMaterialRequest,
  createRFQFromMaterialRequest,
} from "../../api/createRFQFromMaterialRequest";
import { fetchMaterialRequestWorkflow } from "../../api/materialRequestWorkflow";
import { findActiveRfqForMaterialRequest } from "../../api/mrRfqAction";
import { getRFQTemplates, getRFQTemplate } from "../../api/rfqTemplates";
import { incrementLocalTemplateUsage } from "../../api/rfqTemplateStorage";
import {
  buildManualCreationMeta,
  buildMetaFromTemplate,
  formatRequiredDocumentsList,
  stashRFQCreationMeta,
} from "../../api/rfqCreationMeta";
import type { RFQTemplate } from "../../types/erpnext";
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  DEFAULT_WORKFLOW_RULES,
} from "../../types/erpnext";
import PageHeader from "../../components/PageHeader";
import RFQItemLineRow, {
  type RFQItemLine,
} from "../../components/RFQItemLineRow";
import StatusBadge from "../../components/StatusBadge";
import {
  Drawing2dCell,
  PartNameCell,
} from "../../components/warehouse/EngineeringDocCells";
import { ErpNextDatePicker } from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { ownerTitleFromEmail } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import type { Supplier } from "../../types/erpnext";
import { isoDateOffset, todayIso, formatCurrency } from "../../utils/format";
import { assertERPNextDate } from "../../utils/erpNextDate";
import { generateId } from "../../utils/id";
import { pickEngineeringDocs } from "../../utils/materialRequestItemFiles";

type ItemRow = RFQItemLine;

interface SupplierWithMeta extends Supplier {
  po_count?: number;
}

const STEPS = [
  { id: 1, label: "RFQ Details" },
  { id: 2, label: "Add Items" },
  { id: 3, label: "Select Suppliers" },
  { id: 4, label: "Review & Submit" },
] as const;

type WizardStep = 1 | 2 | 3 | 4;

/** Read-only Material Request context captured when creating from an MR. */
interface MrContext {
  material_request: string;
  department: string;
  company: string;
  priority: string;
  procurement_owner: string;
  warehouse_remarks: string;
}

const newItemRow = (): ItemRow => ({
  id: generateId(),
  item_group: "",
  item_code: "",
  item_name: "",
  description: "",
  qty: 1,
  uom: "Nos",
});

function buildTemplateTermsBlock(template: RFQTemplate): string {
  const lines: string[] = [];
  if (template.description?.trim()) lines.push(template.description.trim());
  if (template.rfq_type) lines.push(`RFQ Type: ${template.rfq_type}`);
  const docs = formatRequiredDocumentsList(template.required_documents);
  if (docs) lines.push(`Required Documents: ${docs}`);
  return lines.join("\n\n");
}

type CreationMode = "scratch" | "template" | null;

export default function NewRFQPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<WizardStep>(1);
  const [submitting, setSubmitting] = useState(false);

  // ── Creation mode (template vs scratch) ──────────────────────────────
  const [creationMode, setCreationMode] = useState<CreationMode>(null);
  const [appliedTemplate, setAppliedTemplate] = useState<RFQTemplate | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const autoAppliedRef = useRef(false);
  const mrAppliedRef = useRef(false);

  const mrParam = searchParams.get("mr");
  const [title, setTitle] = useState("");
  const [validTill, setValidTill] = useState(isoDateOffset(7));
  // Supplier-facing Terms & Conditions (goes into message_for_supplier).
  const [supplierTerms, setSupplierTerms] = useState("");
  const [requireCostBreakdown, setRequireCostBreakdown] = useState(false);
  // Internal procurement notes — never sent to suppliers.
  const [internalNotes, setInternalNotes] = useState("");
  // Read-only Material Request context (only when created from an MR).
  const [mrContext, setMrContext] = useState<MrContext | null>(null);

  // Step 2
  const [items, setItems] = useState<ItemRow[]>([newItemRow()]);
  const [showItemErrors, setShowItemErrors] = useState(false);

  // Step 3
  const [supplierSearch, setSupplierSearch] = useState("");
  const debouncedSearch = useDebounce(supplierSearch, 300);
  const [selectedSuppliers, setSelectedSuppliers] = useState<SupplierWithMeta[]>(
    []
  );

  /* ---------- Template data ---------- */

  const templatesQuery = useQuery<RFQTemplate[]>({
    queryKey: ["rfq-templates-active"],
    enabled: creationMode === "template",
    staleTime: 5 * 60_000,
    queryFn: () => getRFQTemplates({ filters: [["status", "=", "Active"]] }),
  });

  async function applyTemplate(template: RFQTemplate) {
    setApplyingTemplate(true);
    try {
      setTitle(template.template_name);
      setSupplierTerms(buildTemplateTermsBlock(template));

      // Resolve items — fetch item_group from Item master for each item_code
      if (template.items?.length) {
        const itemCodes = template.items.map((i) => i.item_code);
        let itemDetails: Array<{
          name: string;
          item_code?: string;
          item_name?: string;
          item_group?: string;
          stock_uom?: string;
          description?: string;
        }> = [];
        try {
          itemDetails = await apiGet(
            "/api/resource/Item",
            {
              params: {
                filters: JSON.stringify([
                  ["disabled", "=", 0],
                  ["item_code", "in", itemCodes],
                ]),
                fields: JSON.stringify([
                  "name",
                  "item_code",
                  "item_name",
                  "item_group",
                  "stock_uom",
                  "description",
                  "disabled",
                ]),
                limit_page_length: 100,
              },
            }
          );
        } catch {
          /* proceed with template data only */
        }

        const detailMap = new Map(
          (itemDetails ?? []).map((d) => [d.item_code ?? d.name, d])
        );

        const itemRows: ItemRow[] = template.items.map((tplItem) => {
          const detail = detailMap.get(tplItem.item_code);
          const spec = tplItem.specification?.trim();
          const baseDesc =
            spec ||
            detail?.description ||
            tplItem.item_name ||
            "";
          return {
            id: generateId(),
            item_group: detail?.item_group ?? "",
            item_code: tplItem.item_code,
            item_name: detail?.item_name ?? tplItem.item_name ?? tplItem.item_code,
            description: baseDesc,
            qty: tplItem.qty ?? 1,
            uom: detail?.stock_uom ?? tplItem.uom ?? "Nos",
          };
        });

        setItems(itemRows.length > 0 ? itemRows : [newItemRow()]);
      }

      // Resolve suppliers — fetch full Supplier records for the template's defaults
      if (template.suppliers?.length) {
        const supplierNames = template.suppliers.map((s) => s.supplier);
        let supplierDetails: Supplier[] = [];
        try {
          supplierDetails = await apiGet(
            "/api/resource/Supplier",
            {
              params: {
                filters: JSON.stringify([["name", "in", supplierNames]]),
                fields: JSON.stringify([
                  "name",
                  "supplier_name",
                  "supplier_group",
                  "country",
                  "disabled",
                ]),
                limit_page_length: 100,
              },
            }
          );
        } catch {
          /* proceed without pre-filling suppliers */
        }

        const activeSuppliers = (supplierDetails ?? []).filter(
          (s) => !s.disabled
        );
        setSelectedSuppliers(activeSuppliers);
      }

      setAppliedTemplate(template);
      toast.success(`Template "${template.template_name}" applied`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[NewRFQ] Error applying template — proceeding with available data:", err);
      setAppliedTemplate(template);
    } finally {
      setApplyingTemplate(false);
    }
  }

  // Auto-apply Material Request from ?mr=NAME query param
  useEffect(() => {
    if (!mrParam || mrAppliedRef.current) return;
    mrAppliedRef.current = true;
    setCreationMode("scratch");

    (async () => {
      try {
        // One MR → one active RFQ. Cancelled / Rejected do not redirect.
        const mrDoc = await fetchMaterialRequestWorkflow(mrParam);
        const existing = await findActiveRfqForMaterialRequest(
          mrParam,
          mrDoc,
        );
        if (existing) {
          toast.error(
            `An RFQ already exists for this Material Request (${existing}).`,
          );
          navigate(`/sourcing/rfq/${encodeURIComponent(existing)}`, {
            replace: true,
          });
          return;
        }

        const prefill = await buildRFQPrefillFromMaterialRequest(mrParam);
        const dept = prefill.department?.trim() || "General";
        // Professional title — no "RFQ from MAT-MR-xxxx".
        setTitle(`Procurement RFQ – ${dept}`);
        setSupplierTerms(prefill.message_for_supplier);
        setMrContext({
          material_request: prefill.material_request,
          department: dept,
          company: prefill.company || ENV_DEFAULTS.company || "—",
          priority: prefill.priority?.trim() || "Medium",
          procurement_owner:
            ownerTitleFromEmail(user?.email ?? user?.name) ||
            "Procurement Manager",
          warehouse_remarks: prefill.warehouse_remarks?.trim() || "",
        });
        if (prefill.items.length > 0) {
          setItems(
            prefill.items.map((row) => {
              const docs = pickEngineeringDocs({
                ...row,
                attachments: row.attachments,
              });
              const first = docs.attachments[0];
              return {
                id: generateId(),
                item_group: row.item_group || "Unknown",
                item_code: row.item_code,
                item_name: row.item_name ?? row.item_code,
                description: row.description ?? "",
                qty: row.qty,
                uom: row.uom ?? "Nos",
                part_name: docs.part_name ?? row.custom_part_name,
                drawing_2d_url: docs.drawing_2d_url ?? row.custom_2d_drawing,
                attachments: docs.attachments,
                attachment_name:
                  row.attachment_name ?? first?.fileName,
                attachment_url: row.attachment_url ?? first?.fileUrl,
                attachment_type:
                  row.attachment_type ?? first?.fileType,
              };
            }),
          );
        }
        toast.success(`Items loaded from Material Request ${mrParam}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load Material Request"
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrParam]);

  // Auto-apply template from ?template=NAME query param
  const templateParam = searchParams.get("template");
  useEffect(() => {
    if (!templateParam || autoAppliedRef.current || appliedTemplate) return;
    autoAppliedRef.current = true;
    setCreationMode("template");

    (async () => {
      try {
        const tpl = await getRFQTemplate(templateParam);
        if (tpl) {
          await applyTemplate(tpl);
          return;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[NewRFQ] Backend template fetch failed, trying local list:", err);
      }

      // Fallback: look up the template from the already-cached list query
      try {
        const allTemplates = await getRFQTemplates({ filters: [["status", "=", "Active"]] });
        const localMatch = allTemplates.find(
          (t) => t.name === templateParam || t.template_name === templateParam
        );
        if (localMatch) {
          await applyTemplate(localMatch);
          return;
        }
      } catch (listErr) {
        // eslint-disable-next-line no-console
        console.warn("[NewRFQ] Template list fallback also failed:", listErr);
      }

      // Final fallback: open blank RFQ form (never block navigation)
      // eslint-disable-next-line no-console
      console.warn("[NewRFQ] No template data available — opening blank RFQ form");
      setCreationMode("scratch");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateParam]);

  /* ---------- Validation ---------- */

  const step1Valid = title.trim().length > 0 && !!validTill;
  const step2Valid =
    items.length > 0 &&
    items.every((i) => i.item_group && i.item_code && i.qty > 0);
  const step3Valid = selectedSuppliers.length >= 2;

  // Compact RFQ summary figures (live, derived from the current form state).
  const totalItems = items.filter((i) => i.item_code).length || items.length;
  const totalQty = items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

  /* ---------- Step 3 data ---------- */

  const suppliersQuery = useQuery<Supplier[]>({
    queryKey: ["rfq-supplier-search", debouncedSearch],
    enabled: step === 3,
    staleTime: 30_000,
    queryFn: () => {
      const filters: Array<[string, string, string | number]> = [
        ["disabled", "=", 0],
      ];
      if (debouncedSearch.trim()) {
        filters.push(["supplier_name", "like", `%${debouncedSearch.trim()}%`]);
      }
      return apiGet<Supplier[]>("/api/resource/Supplier", {
        params: {
          filters: JSON.stringify(filters),
          fields: JSON.stringify([
            "name",
            "supplier_name",
            "supplier_group",
            "country",
            "disabled",
          ]),
          limit_page_length: 20,
          order_by: "supplier_name asc",
        },
      });
    },
  });

  const supplierNames = useMemo(
    () => (suppliersQuery.data ?? []).map((s) => s.name),
    [suppliersQuery.data]
  );

  // Aggregate PO counts for the visible suppliers in one round-trip.
  const poCountQuery = useQuery({
    queryKey: ["rfq-supplier-po-count", supplierNames],
    enabled: step === 3 && supplierNames.length > 0,
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const rows = await apiGet<Array<{ supplier: string; name: string }>>(
        "/api/resource/Purchase Order",
        {
          params: {
            filters: JSON.stringify([["supplier", "in", supplierNames]]),
            fields: JSON.stringify(["name", "supplier"]),
            limit_page_length: 500,
          },
        }
      );
      const counts = new Map<string, number>();
      for (const r of rows) {
        if (!r.supplier) continue;
        counts.set(r.supplier, (counts.get(r.supplier) ?? 0) + 1);
      }
      return counts;
    },
  });

  const visibleSuppliers: SupplierWithMeta[] = useMemo(
    () =>
      (suppliersQuery.data ?? []).map((s) => ({
        ...s,
        po_count: poCountQuery.data?.get(s.name),
      })),
    [suppliersQuery.data, poCountQuery.data]
  );

  /* ---------- Handlers ---------- */

  function addItemRow() {
    setItems((rows) => [...rows, newItemRow()]);
  }

  function removeItemRow(id: string) {
    setItems((rows) =>
      rows.length === 1 ? rows : rows.filter((r) => r.id !== id)
    );
  }

  function updateItemRow(id: string, patch: Partial<ItemRow>) {
    setItems((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function toggleSupplier(supplier: SupplierWithMeta) {
    setSelectedSuppliers((prev) => {
      if (prev.some((p) => p.name === supplier.name)) {
        return prev.filter((p) => p.name !== supplier.name);
      }
      return [...prev, supplier];
    });
  }

  function removeSelected(name: string) {
    setSelectedSuppliers((prev) => prev.filter((s) => s.name !== name));
  }

  async function handleSubmit() {
    if (!step1Valid || !step2Valid || !step3Valid) {
      toast.error("Please complete all steps.");
      return;
    }

    setSubmitting(true);
    try {
      // ERPNext's standard RFQ schema doesn't have `valid_till` or `title`,
      // so we embed them at the top of message_for_supplier where the
      // supplier's quotation form will display them. The detail page
      // parses `Valid Till:` back out for the AI panel.
      const lines: string[] = [];
      if (title.trim()) lines.push(`Title: ${title.trim()}`);
      if (validTill) {
        lines.push(`Valid Till: ${assertERPNextDate(validTill, "valid_till")}`);
      }
      if (appliedTemplate?.rfq_type && !supplierTerms.includes("RFQ Type:")) {
        lines.push(`RFQ Type: ${appliedTemplate.rfq_type}`);
      }
      if (appliedTemplate?.required_documents) {
        const docLine = formatRequiredDocumentsList(appliedTemplate.required_documents);
        if (docLine && !supplierTerms.includes("Required Documents:")) {
          lines.push(`Required Documents: ${docLine}`);
        }
      }
      // Only the supplier-facing Terms & Conditions are embedded in the message.
      // Internal Procurement Notes are intentionally excluded here so nothing
      // internal ever reaches suppliers.
      if (supplierTerms.trim()) {
        if (lines.length > 0) lines.push("");
        lines.push(supplierTerms.trim());
      }
      const message = lines.join("\n");

      const scheduleIso = validTill
        ? assertERPNextDate(validTill, "schedule_date")
        : undefined;

      const rfqPayload = {
        transaction_date: todayIso(),
        message_for_supplier: message,
        company: ENV_DEFAULTS.company || undefined,
        items: items.map((row) => ({
          item_code: row.item_code,
          item_name: row.item_name,
          description: row.description || row.item_name || row.item_code,
          qty: row.qty,
          uom: row.uom,
          schedule_date: scheduleIso,
        })),
        suppliers: selectedSuppliers.map((s) => ({
          supplier: s.name,
          supplier_name: s.supplier_name,
        })),
      };

      // eslint-disable-next-line no-console
      console.log("Final API Payload", rfqPayload);

      const created = mrParam
        ? await createRFQFromMaterialRequest({
            material_request: mrParam,
            transaction_date: rfqPayload.transaction_date,
            message_for_supplier: message,
            company: rfqPayload.company,
            suppliers: rfqPayload.suppliers,
            // Internal notes persist to the MR (custom_procurement_remarks),
            // never to the supplier message.
            procurement_remarks: internalNotes.trim() || undefined,
          })
        : await createRFQ(rfqPayload);

      const creationMeta = appliedTemplate
        ? buildMetaFromTemplate(appliedTemplate)
        : creationMode === "scratch"
          ? buildManualCreationMeta({
              required_documents: { ...DEFAULT_REQUIRED_DOCUMENTS },
              workflow_rules: { ...DEFAULT_WORKFLOW_RULES },
              created_by:
                ownerTitleFromEmail(user?.email ?? user?.name) ||
                "Procurement Manager",
              internal_notes: internalNotes.trim() || undefined,
            })
          : null;

      if (creationMeta) {
        stashRFQCreationMeta(created.name, creationMeta);
      }
      if (appliedTemplate) {
        incrementLocalTemplateUsage(appliedTemplate.name);
      }

      // Custom field — written after create so createRFQ stays on stock fields.
      if (requireCostBreakdown) {
        try {
          await updateRFQ(created.name, {
            custom_require_cost_breakdown: 1,
          });
        } catch (flagErr) {
          // eslint-disable-next-line no-console
          console.warn(
            "[RFQ] Could not set custom_require_cost_breakdown:",
            flagErr,
          );
          toast.error(
            "RFQ created, but Require Cost Breakdown could not be saved. Enable it on the RFQ if needed.",
          );
        }
      }

      toast.success(`RFQ ${created.name} created`);
      // Creating an RFQ (especially from a forwarded MR) moves the request out
      // of "awaiting RFQ" — keep the Warehouse & procurement dashboards live.
      void queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-forwarded-history"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      void queryClient.invalidateQueries({ queryKey: ["material-requests-workflow"] });
      navigate(`/sourcing/rfq/${encodeURIComponent(created.name)}`);
    } catch (err) {
      if (err instanceof ActiveRfqExistsError) {
        toast.error(err.message);
        navigate(`/sourcing/rfq/${encodeURIComponent(err.rfqName)}`, {
          replace: true,
        });
        return;
      }
      // The axios interceptor already raises a toast and logs detail to
      // the console — re-emit a contextual error here in case the error
      // came from our payload validation rather than the network.
      if (err instanceof Error && !/[Rr]equest failed/.test(err.message)) {
        toast.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- Render ---------- */

  // Mode not yet chosen — show the selector (skip when creating from MR)
  if (creationMode === null && !mrParam) {
    return (
      <div>
        <Link
          to="/sourcing/rfq"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RFQs
        </Link>

        <PageHeader
          title="Create RFQ"
          description="Choose how you'd like to create your Request for Quotation."
        />

        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setCreationMode("scratch")}
            className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-neutral-200 bg-white p-8 text-center transition-all hover:border-primary-400 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary transition-colors group-hover:bg-primary-100">
              <PenLine className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-900">
                Create from Scratch
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Build a new RFQ step by step with full control over items, suppliers, and terms.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setCreationMode("template")}
            className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-neutral-200 bg-white p-8 text-center transition-all hover:border-primary-400 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent-600 transition-colors group-hover:bg-accent-100">
              <LayoutTemplate className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-900">
                Use Template
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Start from a saved template with pre-filled items, suppliers, and terms.
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Template mode — but template not yet selected
  if (creationMode === "template" && !appliedTemplate) {
    return (
      <div>
        <Link
          to="/sourcing/rfq"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RFQs
        </Link>

        <PageHeader
          title="Select a Template"
          description="Choose a template to pre-fill your RFQ."
          actions={
            <button
              type="button"
              onClick={() => setCreationMode(null)}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          }
        />

        {applyingTemplate && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-neutral-600">Applying template…</span>
          </div>
        )}

        {!applyingTemplate && templatesQuery.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-neutral-600">Loading templates…</span>
          </div>
        )}

        {!applyingTemplate && !templatesQuery.isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(templatesQuery.data ?? []).length === 0 ? (
              <div className="col-span-full flex flex-col items-center gap-2 py-16 text-center">
                <LayoutTemplate className="h-8 w-8 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-600">
                  No active templates found
                </p>
                <p className="text-xs text-neutral-500">
                  Create one from Sourcing &gt; RFQ Template Library.
                </p>
                <button
                  type="button"
                  onClick={() => setCreationMode("scratch")}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                >
                  Create from Scratch
                </button>
              </div>
            ) : (
              (templatesQuery.data ?? []).map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  disabled={applyingTemplate}
                  className="group flex flex-col items-start gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:border-primary-400 hover:shadow-md disabled:opacity-60"
                >
                  <div className="flex w-full items-start justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <TemplateBadge type={tpl.category} />
                  </div>
                  <h4 className="text-sm font-semibold text-neutral-900 group-hover:text-primary">
                    {tpl.template_name}
                  </h4>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                    <span>{tpl.items?.length ?? 0} items</span>
                    <span>{tpl.suppliers?.length ?? 0} suppliers</span>
                    {tpl.estimated_value ? (
                      <span>Est. {formatCurrency(tpl.estimated_value)}</span>
                    ) : null}
                    {(tpl.usage_count ?? 0) > 0 && (
                      <span>Used {tpl.usage_count}×</span>
                    )}
                  </div>
                  {tpl.description && (
                    <p className="line-clamp-2 text-xs text-neutral-400">
                      {tpl.description}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Main wizard (scratch or template applied) ─────────────────────────

  return (
    <div>
      <Link
        to="/sourcing/rfq"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to RFQs
      </Link>

      <PageHeader
        title="Create RFQ"
        description="Issue a quote request to multiple suppliers in four steps."
      />

      {mrContext && <MrContextBanner ctx={mrContext} />}

      <RfqSummaryCard
        materialRequest={mrContext?.material_request}
        totalItems={totalItems}
        totalQty={totalQty}
        priority={mrContext?.priority}
      />

      <div className="mt-4">
        <Stepper step={step} />
      </div>

      <div className="mt-6 card">
        {step === 1 && (
          <Step1
            title={title}
            setTitle={setTitle}
            validTill={validTill}
            setValidTill={setValidTill}
            supplierTerms={supplierTerms}
            setSupplierTerms={setSupplierTerms}
            internalNotes={internalNotes}
            setInternalNotes={setInternalNotes}
            warehouseRemarks={mrContext?.warehouse_remarks ?? ""}
            requireCostBreakdown={requireCostBreakdown}
            setRequireCostBreakdown={setRequireCostBreakdown}
          />
        )}

        {step === 2 && (
          <Step2
            items={items}
            showErrors={showItemErrors}
            addItemRow={addItemRow}
            removeItemRow={removeItemRow}
            updateItemRow={updateItemRow}
          />
        )}

        {step === 3 && (
          <Step3
            search={supplierSearch}
            setSearch={setSupplierSearch}
            isLoading={suppliersQuery.isLoading || suppliersQuery.isFetching}
            visibleSuppliers={visibleSuppliers}
            selectedSuppliers={selectedSuppliers}
            toggleSupplier={toggleSupplier}
            removeSelected={removeSelected}
          />
        )}

        {step === 4 && (
          <Step4
            title={title}
            validTill={validTill}
            supplierTerms={supplierTerms}
            internalNotes={internalNotes}
            items={items}
            selectedSuppliers={selectedSuppliers}
            totalItems={totalItems}
            totalQty={totalQty}
            mrContext={mrContext}
            requireCostBreakdown={requireCostBreakdown}
          />
        )}

        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
            disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !step1Valid) {
                  toast.error("Title and Valid Till are required.");
                  return;
                }
                if (step === 2 && !step2Valid) {
                  setShowItemErrors(true);
                  toast.error(
                    "Each line needs Item Group, Item, and Quantity greater than 0."
                  );
                  return;
                }
                if (step === 3 && !step3Valid) {
                  toast.error("Select at least 2 suppliers to continue.");
                  return;
                }
                setShowItemErrors(false);
                setStep((s) => (s + 1) as WizardStep);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !step1Valid || !step2Valid || !step3Valid}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {submitting ? "Creating…" : "Create RFQ"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Stepper
 * ========================================================================== */

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((s, idx) => {
        const isComplete = step > s.id;
        const isCurrent = step === s.id;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset ${
                isCurrent
                  ? "bg-primary text-white ring-primary"
                  : isComplete
                  ? "bg-accent-50 text-accent-700 ring-accent-200"
                  : "bg-neutral-100 text-neutral-500 ring-neutral-200"
              }`}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" /> : s.id}
            </div>
            <span
              className={`text-sm ${
                isCurrent
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-500"
              }`}
            >
              {s.label}
            </span>
            {idx < STEPS.length - 1 && (
              <ChevronDown className="mx-1 h-3.5 w-3.5 -rotate-90 text-neutral-300" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ============================================================================
 * Step 1 — RFQ Details
 * ========================================================================== */

interface Step1Props {
  title: string;
  setTitle: (v: string) => void;
  validTill: string;
  setValidTill: (v: string) => void;
  supplierTerms: string;
  setSupplierTerms: (v: string) => void;
  internalNotes: string;
  setInternalNotes: (v: string) => void;
  warehouseRemarks: string;
  requireCostBreakdown: boolean;
  setRequireCostBreakdown: (v: boolean) => void;
}

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

function Step1({
  title,
  setTitle,
  validTill,
  setValidTill,
  supplierTerms,
  setSupplierTerms,
  internalNotes,
  setInternalNotes,
  warehouseRemarks,
  requireCostBreakdown,
  setRequireCostBreakdown,
}: Step1Props) {
  return (
    <div className="space-y-5 p-5">
      {/* Responsive two-column grid for the core fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="rfq-title"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            RFQ Title <span className="text-danger-600">*</span>
          </label>
          <input
            id="rfq-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Production Procurement – Bearings"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label
            htmlFor="rfq-valid"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            Valid Till <span className="text-danger-600">*</span>
          </label>
          <ErpNextDatePicker
            value={validTill}
            min={todayIso()}
            onChange={setValidTill}
            required
          />
          <p className="mt-1 text-xs text-neutral-500">
            Defaults to 7 days from today. Adjust if needed.
          </p>
        </div>
      </div>

      {/* Warehouse Remarks — read-only context from the Material Request */}
      {warehouseRemarks && (
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
            <Warehouse className="h-3.5 w-3.5 text-neutral-400" />
            Warehouse Remarks
            <span className="text-xs font-normal text-neutral-400">(read-only)</span>
          </label>
          <div className="whitespace-pre-line rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
            {warehouseRemarks}
          </div>
        </div>
      )}

      {/* Supplier-facing Terms & Conditions */}
      <div>
        <label
          htmlFor="rfq-supplier-terms"
          className="mb-1.5 block text-sm font-medium text-neutral-700"
        >
          Supplier Terms &amp; Conditions
        </label>
        <textarea
          id="rfq-supplier-terms"
          rows={5}
          value={supplierTerms}
          onChange={(e) => setSupplierTerms(e.target.value)}
          placeholder="Payment terms, delivery expectations, quality requirements…"
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Shared with suppliers in the quotation request.
        </p>
      </div>

      {/* Cost Breakdown requirement — supplier quotation module */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3.5 py-3">
        <input
          type="checkbox"
          checked={requireCostBreakdown}
          onChange={(e) => setRequireCostBreakdown(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
        />
        <span>
          <span className="block text-sm font-medium text-neutral-800">
            Require Cost Breakdown
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            Invited suppliers must provide a cost breakdown (manual or Excel)
            with their quotation. Hidden when disabled.
          </span>
        </span>
      </label>

      {/* Internal Procurement Notes — never sent to suppliers */}
      <div>
        <label
          htmlFor="rfq-internal-notes"
          className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-neutral-700"
        >
          <Lock className="h-3.5 w-3.5 text-neutral-400" />
          Internal Procurement Notes
        </label>
        <textarea
          id="rfq-internal-notes"
          rows={3}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Notes for your procurement team only…"
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Internal only — never shared with suppliers.
        </p>
      </div>
    </div>
  );
}

/* ============================================================================
 * Material Request context banner + compact RFQ summary
 * ========================================================================== */

function MrContextBanner({ ctx }: { ctx: MrContext }) {
  const cells: Array<{ icon: typeof Building2; label: string; value: string }> = [
    { icon: FileText, label: "Material Request", value: ctx.material_request },
    { icon: Layers, label: "Department", value: ctx.department },
    { icon: Building2, label: "Company", value: ctx.company },
    { icon: ClipboardCheck, label: "Priority", value: ctx.priority },
    { icon: Users, label: "Procurement Owner", value: ctx.procurement_owner },
  ];
  return (
    <div className="mt-2 rounded-xl border border-primary-100 bg-primary-50/50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-700">
        Created from Material Request
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <c.icon className="h-3 w-3" />
              {c.label}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-neutral-900" title={c.value}>
              {c.value || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RfqSummaryCard({
  materialRequest,
  totalItems,
  totalQty,
  priority,
}: {
  materialRequest?: string;
  totalItems: number;
  totalQty: number;
  priority?: string;
}) {
  const cells = [
    { icon: FileText, label: "Material Request", value: materialRequest ?? "—" },
    { icon: Boxes, label: "Total Items", value: String(totalItems) },
    { icon: Layers, label: "Total Quantity", value: String(totalQty) },
    { icon: Wallet, label: "Budget Status", value: "Check on RFQ page" },
    { icon: ClipboardCheck, label: "Priority", value: priority ?? "Medium" },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm"
        >
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <c.icon className="h-3 w-3" />
            {c.label}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-neutral-900" title={c.value}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
 * Step 2 — Add Items
 * ========================================================================== */

interface Step2Props {
  items: ItemRow[];
  showErrors: boolean;
  addItemRow: () => void;
  removeItemRow: (id: string) => void;
  updateItemRow: (id: string, patch: Partial<ItemRow>) => void;
}

function Step2({
  items,
  showErrors,
  addItemRow,
  removeItemRow,
  updateItemRow,
}: Step2Props) {
  const groupsQuery = useQuery({
    queryKey: ["item-groups"],
    queryFn: () => getItemGroups(),
    staleTime: 5 * 60_000,
  });

  const itemGroups = groupsQuery.data ?? [];

  return (
    <div className="p-5">
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/40 px-4 py-3">
        <Package className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" />
        <div>
          <p className="text-sm font-semibold text-neutral-900">
            Requested Line Items
          </p>
          <p className="mt-0.5 text-xs text-neutral-600">
            Select an Item Group first, then choose items from your inventory
            master. Description and UOM are filled automatically.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-3 w-12">#</th>
                <th className="px-3 py-3 min-w-[160px]">
                  Item Group <span className="text-danger-500">*</span>
                </th>
                <th className="px-3 py-3 min-w-[180px]">
                  Item <span className="text-danger-500">*</span>
                </th>
                <th className="px-3 py-3 min-w-[200px]">Description</th>
                <th className="px-3 py-3 w-[100px] text-right">
                  Qty <span className="text-danger-500">*</span>
                </th>
                <th className="px-3 py-3 w-[90px] text-center">UOM</th>
                <th className="px-3 py-3 min-w-[140px]">Part Name</th>
                <th className="px-3 py-3 min-w-[120px]">Attachments</th>
                <th className="px-3 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <RFQItemLineRow
                  key={row.id}
                  row={row}
                  rowNumber={idx + 1}
                  itemGroups={itemGroups}
                  groupsLoading={groupsQuery.isLoading}
                  showErrors={showErrors}
                  canRemove={items.length > 1}
                  onChange={(patch) => updateItemRow(row.id, patch)}
                  onRemove={() => removeItemRow(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={addItemRow}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-700 shadow-sm transition hover:border-primary-400 hover:bg-primary-50"
        >
          <Plus className="h-4 w-4" />
          Add Line Item
        </button>
        <p className="text-xs text-neutral-500">
          {items.length} line{items.length === 1 ? "" : "s"} · Item codes are
          stored automatically
        </p>
      </div>
    </div>
  );
}

/* ============================================================================
 * Step 3 — Select Suppliers
 * ========================================================================== */

interface Step3Props {
  search: string;
  setSearch: (v: string) => void;
  isLoading: boolean;
  visibleSuppliers: SupplierWithMeta[];
  selectedSuppliers: SupplierWithMeta[];
  toggleSupplier: (s: SupplierWithMeta) => void;
  removeSelected: (name: string) => void;
}

function Step3({
  search,
  setSearch,
  isLoading,
  visibleSuppliers,
  selectedSuppliers,
  toggleSupplier,
  removeSelected,
}: Step3Props) {
  return (
    <div className="p-5">
      {selectedSuppliers.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 rounded-lg bg-accent-50/60 p-3 ring-1 ring-inset ring-accent-200">
          <span className="self-center text-xs font-medium uppercase tracking-wide text-accent-700">
            {selectedSuppliers.length} selected:
          </span>
          {selectedSuppliers.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1 rounded-full bg-accent-500 px-2.5 py-1 text-xs font-medium text-white"
            >
              {s.supplier_name}
              <button
                type="button"
                onClick={() => removeSelected(s.name)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/20"
                aria-label={`Remove ${s.supplier_name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative mb-4 max-w-md">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-neutral-400">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers by name…"
          className="w-full rounded-md border border-neutral-300 bg-white pl-8 pr-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
      </div>

      {selectedSuppliers.length < 2 && (
        <p className="mb-3 text-xs text-warning-700">
          Select at least 2 suppliers to issue this RFQ.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && visibleSuppliers.length === 0 ? (
          <div className="col-span-full flex items-center justify-center py-8 text-sm text-neutral-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading suppliers…
          </div>
        ) : visibleSuppliers.length === 0 ? (
          <div className="col-span-full flex flex-col items-center gap-1 py-8 text-center text-sm text-neutral-500">
            <Users className="h-5 w-5 text-neutral-400" />
            <span>No suppliers match.</span>
          </div>
        ) : (
          visibleSuppliers.map((s) => {
            const isSelected = selectedSuppliers.some((x) => x.name === s.name);
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => toggleSupplier(s)}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-accent-500 bg-accent-50 ring-1 ring-accent-300"
                    : "border-neutral-200 bg-white hover:border-primary-300 hover:bg-neutral-50"
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-900">
                    {s.supplier_name}
                  </span>
                  {isSelected && (
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-500 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-500">
                  {s.supplier_group ?? "—"}
                  {s.country && <> &middot; {s.country}</>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-500">
                    Past POs:{" "}
                    <span className="font-medium text-neutral-700">
                      {s.po_count ?? 0}
                    </span>
                  </span>
                  {s.disabled === 1 && <StatusBadge status="Disabled" tone="danger" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * Step 4 — Review & Submit
 * ========================================================================== */

interface Step4Props {
  title: string;
  validTill: string;
  supplierTerms: string;
  internalNotes: string;
  items: ItemRow[];
  selectedSuppliers: SupplierWithMeta[];
  totalItems: number;
  totalQty: number;
  mrContext: MrContext | null;
  requireCostBreakdown: boolean;
}

function Step4({
  title,
  validTill,
  supplierTerms,
  internalNotes,
  items,
  selectedSuppliers,
  totalItems,
  totalQty,
  mrContext,
  requireCostBreakdown,
}: Step4Props) {
  const detailRows: Array<{ label: string; value: string }> = [
    { label: "RFQ Title", value: title || "—" },
    { label: "Valid Till", value: validTill || "—" },
    { label: "Total Items", value: String(totalItems) },
    { label: "Total Quantity", value: String(totalQty) },
    { label: "Suppliers Invited", value: String(selectedSuppliers.length) },
    {
      label: "Cost Breakdown",
      value: requireCostBreakdown ? "Required" : "Not required",
    },
  ];
  if (mrContext) {
    detailRows.splice(
      2,
      0,
      { label: "Material Request", value: mrContext.material_request },
      { label: "Department", value: mrContext.department },
      { label: "Priority", value: mrContext.priority },
    );
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-primary-600" />
        <h3 className="text-base font-semibold text-neutral-900">
          Review before submitting
        </h3>
      </div>

      {/* Key details */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {detailRows.map((row) => (
          <div key={row.label} className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              {row.label}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-neutral-900" title={row.value}>
              {row.value}
            </p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-800">Items</h4>
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-center">UOM</th>
                <th className="px-3 py-2">Part Name</th>
                <th className="px-3 py-2">Attachments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-neutral-900">
                      {row.item_name || row.item_code || "—"}
                    </p>
                    {row.item_code && (
                      <p className="text-xs text-neutral-400">{row.item_code}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{row.item_group || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>
                  <td className="px-3 py-2 text-center text-neutral-600">{row.uom}</td>
                  <td className="px-3 py-2">
                    <PartNameCell value={row.part_name} />
                  </td>
                  <td className="px-3 py-2">
                    <Drawing2dCell
                      url={row.drawing_2d_url}
                      attachments={row.attachments}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Suppliers */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-800">
          Suppliers ({selectedSuppliers.length})
        </h4>
        <div className="flex flex-wrap gap-2">
          {selectedSuppliers.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-accent-200"
            >
              {s.supplier_name}
            </span>
          ))}
        </div>
      </div>

      {/* Supplier terms */}
      {supplierTerms.trim() && (
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-neutral-800">
            Supplier Terms &amp; Conditions
          </h4>
          <p className="whitespace-pre-line rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            {supplierTerms.trim()}
          </p>
        </div>
      )}

      {/* Internal notes */}
      {internalNotes.trim() && (
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
            <Lock className="h-3.5 w-3.5 text-neutral-400" />
            Internal Procurement Notes
          </h4>
          <p className="whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-neutral-700">
            {internalNotes.trim()}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Internal only — not included in the supplier request.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Template type badge (used in template picker)
 * ========================================================================== */

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  "Raw Materials": "bg-blue-100 text-blue-700",
  "Manufacturing Components": "bg-violet-100 text-violet-700",
  "Electrical Components": "bg-amber-100 text-amber-700",
  "Packaging Materials": "bg-emerald-100 text-emerald-700",
  "MRO Supplies": "bg-cyan-100 text-cyan-700",
  "Warehouse Consumables": "bg-orange-100 text-orange-700",
  "IT Equipment": "bg-indigo-100 text-indigo-700",
  "Logistics & Transportation": "bg-rose-100 text-rose-700",
};

function TemplateBadge({ type }: { type?: string }) {
  const label = type || "—";
  const classes = TEMPLATE_TYPE_COLORS[label] ?? "bg-neutral-100 text-neutral-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
