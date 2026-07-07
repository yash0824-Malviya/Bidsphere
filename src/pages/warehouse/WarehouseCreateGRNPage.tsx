import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  PackagePlus,
  Search,
  Truck,
  Upload,
} from "lucide-react";

import { apiGet, COMPANY, fetchServerDate, withSilent } from "../../api/erpnext";
import { uploadFileToERPNext } from "../../api/legalDocsStorage";
import {
  createPurchaseReceipt,
  getIncomingPurchaseOrders,
  getPurchaseOrder,
  getPurchaseReceipt,
  getPurchaseReceipts,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import { invalidateWarehouseStock } from "../../api/warehouseStock";
import { reconcileProcurementReadyToIssue } from "../../api/materialRequestWorkflow";
import ErrorState from "../../components/ErrorState";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PdfActions from "../../components/PdfActions";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import StatCard from "../../components/ui/StatCard";
import { FilterBar, FilterField, SearchInput } from "../../components/ui";
import Tabs, { useTabParam, type TabDef } from "../../components/Tabs";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import { buildGrnPdf, grnPdfFilename } from "../../utils/pdf/grnPdf";
import { formatCurrency, formatDate, todayIso } from "../../utils/format";
import { formatERPNextDate } from "../../utils/erpNextDate";
import {
  buildUpcomingDeliveries,
  computeReceivingKpis,
  DELIVERY_URGENCY_META,
} from "../../utils/upcomingDeliveries";
import type { PurchaseReceipt, PurchaseReceiptStatus } from "../../types/erpnext";

const REQUEST_TIMEOUT_MS = 5_000;
const STEPS = ["Receive Items", "Attachments", "Review & Submit"] as const;

const PO_DATE_MESSAGE =
  "Goods Receipt Posting Date cannot be earlier than the Purchase Order Posting Date.";

const PO_FUTURE_MESSAGE =
  "Purchase Order date is in the future compared to the ERPNext server date.";

/** True when a GRN failure is a posting-date conflict (future date / before PO). */
function isDateConflictError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return /future date|cannot be before Purchase Order date|posting date/i.test(raw);
}

/**
 * Explain a posting-date conflict clearly. Both ERPNext errors ("future date"
 * and "before Purchase Order date") stem from the same root cause: the Purchase
 * Order is dated later than the ERPNext server's own `today()`, so no valid
 * posting date exists. That points to a server clock/timezone mismatch — report
 * it plainly instead of showing a raw validation error.
 */
function grnDateConflictMessage(
  serverToday: string | null | undefined,
  poDate: string,
): string {
  const svr = serverToday || "unknown";
  if (poDate && svr !== "unknown" && poDate > svr) {
    return `This goods receipt can't be posted yet. The Purchase Order is dated ${poDate}, which is later than the ERPNext server date (${svr}). This usually indicates a server clock or timezone mismatch. Please correct the ERPNext server date/timezone (or the Purchase Order date), then try again.`;
  }
  return `Posting date conflict against the ERPNext server date${
    svr !== "unknown" ? ` (${svr})` : ""
  }. Please verify the ERPNext server clock/timezone and the Purchase Order date, then try again.`;
}

/**
 * Surface the real ERPNext validation message whenever we have one. The axios
 * response interceptor already extracts ERPNext's human message (e.g. "Posting
 * Date 2026-07-04 cannot be before Purchase Order date 2026-07-05.") into
 * `error.message`, so we show that verbatim and only fall back to a generic
 * line for opaque failures or raw Python tracebacks (never shown to users).
 */
function friendlyGrnError(err: unknown): string {
  // eslint-disable-next-line no-console
  console.error("[GRN submit] failed:", err);
  const raw =
    err instanceof Error ? (err.message ?? "").trim() : String(err ?? "").trim();
  const isOpaque =
    !raw ||
    /^request failed$/i.test(raw) ||
    /Traceback \(most recent call last\)/i.test(raw);
  return isOpaque ? "Unable to create the Goods Receipt. Please try again." : raw;
}

const REJECTION_REASONS = [
  "Damaged",
  "Wrong Item",
  "Quality Issue",
  "Other",
] as const;

type RejectionReason = (typeof REJECTION_REASONS)[number];

type ListTab = "upcoming" | "history";

const GRN_STATUS_OPTIONS: Array<"" | PurchaseReceiptStatus> = [
  "",
  "Draft",
  "To Bill",
  "Completed",
  "Closed",
  "Cancelled",
  "Return Issued",
];

interface WarehouseRow {
  name: string;
  warehouse_name?: string;
}

interface GrnLineRow {
  itemId: string;
  item_code: string;
  item_name?: string;
  ordered_qty: number;
  pending_qty: number;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  rejection_reason: RejectionReason | "";
  batch_no: string;
  expiry_date: string;
  rate: number;
  uom?: string;
  warehouse?: string;
  po_item: string;
}

interface AttachmentEntry {
  id: string;
  file: File;
}

interface FieldErrors {
  warehouse?: string;
  lines?: Record<string, string>;
  submit?: string;
}

function stepClass(active: boolean, done: boolean): string {
  if (active) return "border-primary-500 bg-primary-50 text-primary-700";
  if (done) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-white text-slate-500";
}

export default function WarehouseCreateGRNPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canAct = canCreateGRN(role);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialPO = searchParams.get("po") ?? "";

  const [tab, setTab] = useTabParam<ListTab>("upcoming");
  const [wizardActive, setWizardActive] = useState(!!initialPO);

  const [step, setStep] = useState(0);
  const [poName, setPoName] = useState(initialPO);
  const [warehouse, setWarehouse] = useState("");
  const [postingDate, setPostingDate] = useState(todayIso());
  // Whether the user explicitly picked a posting date. When false, ERPNext is
  // left to stamp its own server date, avoiding client-timezone future-date errors.
  const [postingDateTouched, setPostingDateTouched] = useState(false);
  const [rows, setRows] = useState<GrnLineRow[]>([]);
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submittedGrnName, setSubmittedGrnName] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /*  Upcoming Deliveries — shared by the tab list and the receive wizard    */
  /* ---------------------------------------------------------------------- */

  const incomingQuery = useQuery({
    queryKey: ["incoming-purchase-orders"],
    queryFn: getIncomingPurchaseOrders,
    staleTime: 60_000,
    retry: 1,
  });

  // ERPNext server date (not the browser clock) — the reference "today".
  const serverDateQuery = useQuery({
    queryKey: ["erpnext-server-date"],
    queryFn: fetchServerDate,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const serverToday = serverDateQuery.data ?? todayIso();

  const deliveries = useMemo(
    () => buildUpcomingDeliveries(incomingQuery.data ?? []),
    [incomingQuery.data]
  );
  const receivingKpis = useMemo(
    () => computeReceivingKpis(deliveries),
    [deliveries]
  );

  const [upcomingSearch, setUpcomingSearch] = useState("");
  const debouncedUpcomingSearch = useDebounce(upcomingSearch, 300);
  const filteredDeliveries = useMemo(() => {
    const q = debouncedUpcomingSearch.trim().toLowerCase();
    if (!q) return deliveries;
    return deliveries.filter((d) => {
      const supplier = (d.supplier_name ?? d.supplier ?? "").toLowerCase();
      return d.name.toLowerCase().includes(q) || supplier.includes(q);
    });
  }, [deliveries, debouncedUpcomingSearch]);

  /* ---------------------------------------------------------------------- */
  /*  GRN History                                                            */
  /* ---------------------------------------------------------------------- */

  const grnHistoryQuery = useQuery({
    queryKey: ["purchase-receipts", "warehouse-history"],
    queryFn: () =>
      getPurchaseReceipts({
        filters: [["docstatus", "=", 1]],
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "creation",
          "status",
          "grand_total",
          "currency",
          "total_qty",
        ],
        order_by: "posting_date desc, creation desc, name desc",
        limit_page_length: 200,
      }),
    staleTime: 30_000,
  });

  const grnRows = useMemo(() => grnHistoryQuery.data ?? [], [grnHistoryQuery.data]);

  const [historySearch, setHistorySearch] = useState("");
  const debouncedHistorySearch = useDebounce(historySearch, 300);
  const [historyStatus, setHistoryStatus] = useState<"" | PurchaseReceiptStatus>("");
  const [historySupplier, setHistorySupplier] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    grnRows.forEach((r) => {
      const s = r.supplier_name ?? r.supplier;
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [grnRows]);

  const filteredHistoryRows = useMemo(() => {
    const q = debouncedHistorySearch.trim().toLowerCase();
    return grnRows.filter((r) => {
      if (historyStatus && r.status !== historyStatus) return false;
      if (
        historySupplier &&
        (r.supplier_name ?? r.supplier) !== historySupplier
      )
        return false;
      if (historyDateFrom && r.posting_date && r.posting_date < historyDateFrom)
        return false;
      if (historyDateTo && r.posting_date && r.posting_date > historyDateTo)
        return false;
      if (q) {
        const haystack = `${r.name} ${r.supplier_name ?? ""} ${r.supplier ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    grnRows,
    debouncedHistorySearch,
    historyStatus,
    historySupplier,
    historyDateFrom,
    historyDateTo,
  ]);

  const historyFiltersActive =
    !!historySearch || !!historyStatus || !!historySupplier || !!historyDateFrom || !!historyDateTo;

  function clearHistoryFilters() {
    setHistorySearch("");
    setHistoryStatus("");
    setHistorySupplier("");
    setHistoryDateFrom("");
    setHistoryDateTo("");
  }

  /* ---------------------------------------------------------------------- */
  /*  Receive wizard — warehouses + selected PO line items                   */
  /* ---------------------------------------------------------------------- */

  const warehousesQuery = useQuery({
    queryKey: ["warehouses", COMPANY],
    queryFn: () =>
      apiGet<WarehouseRow[]>("/api/resource/Warehouse", {
        ...withSilent(),
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          filters: JSON.stringify([
            ["company", "=", COMPANY],
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ]),
          fields: JSON.stringify(["name", "warehouse_name"]),
          limit_page_length: 200,
          order_by: "warehouse_name asc",
        },
      }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const poQuery = useQuery({
    queryKey: ["purchase-order", poName],
    queryFn: () => getPurchaseOrder(poName),
    enabled: !!poName,
    staleTime: 0,
    retry: 1,
  });

  useEffect(() => {
    const po = poQuery.data;
    if (!po) {
      setRows([]);
      return;
    }
    setRows(
      (po.items ?? []).map((it) => {
        const ordered = it.qty ?? 0;
        const alreadyReceived = it.received_qty ?? 0;
        const pending = Math.max(0, ordered - alreadyReceived);
        return {
          itemId: it.name ?? `${it.item_code}-${ordered}`,
          item_code: it.item_code,
          item_name: it.item_name,
          ordered_qty: ordered,
          pending_qty: pending,
          received_qty: 0,
          accepted_qty: 0,
          rejected_qty: 0,
          rejection_reason: "",
          batch_no: "",
          expiry_date: "",
          rate: it.rate ?? 0,
          uom: it.uom,
          warehouse: it.warehouse,
          po_item: it.name ?? "",
        };
      })
    );
    if (!warehouse && po.items?.[0]?.warehouse) {
      setWarehouse(po.items[0].warehouse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poQuery.data]);

  // Guard against a broken/unreachable deep link (`?po=` with no matching PO).
  useEffect(() => {
    if (wizardActive && !poName) {
      exitWizard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardActive, poName]);

  const selectedPO = poQuery.data;
  const hasDiscrepancy = rows.some(
    (row) => row.received_qty > 0 && row.received_qty !== row.pending_qty
  );

  // Purchase Order date — ERPNext forbids a GRN posting date earlier than this.
  const poPostingDate = selectedPO?.transaction_date ?? "";
  // Default GRN posting date = max(server today, PO date). Never earlier than
  // the PO date, so ERPNext's "cannot be before Purchase Order date" never fires
  // for the default; also honours the server's own date for the future guard.
  const defaultPostingDate =
    poPostingDate && poPostingDate > serverToday ? poPostingDate : serverToday;
  // Picker bounds: floor at the PO date; ceiling at the later of server-today
  // and the PO date (so a future-dated PO's only valid date stays selectable).
  const pickerMin = poPostingDate || undefined;
  const pickerMax = defaultPostingDate > todayIso() ? defaultPostingDate : todayIso();

  // The Purchase Order is dated later than the ERPNext server's own today() —
  // ERPNext will reject ANY Purchase Receipt against it (no valid posting date
  // exists). We only assert this once the authoritative server date is known,
  // to avoid falsely blocking on an unresolved date.
  const poIsFutureVsServer =
    !!serverDateQuery.data && !!poPostingDate && poPostingDate > serverDateQuery.data;

  // Keep the (untouched) posting date aligned with the computed default as soon
  // as the server date and/or the selected PO resolve.
  useEffect(() => {
    if (!postingDateTouched) {
      setPostingDate(defaultPostingDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPostingDate, postingDateTouched]);

  // Diagnostics: surface the three dates as soon as the PO / server date resolve.
  useEffect(() => {
    if (!poName) return;
    // eslint-disable-next-line no-console
    console.log("[GRN Date Check]", {
      erpServerDate:
        serverDateQuery.data ?? "(unresolved — ERPNext today() will apply)",
      purchaseOrderDate: poPostingDate || "(unknown)",
      postingDate,
      purchaseOrderIsFuture: poIsFutureVsServer,
    });
  }, [poName, poPostingDate, serverDateQuery.data, postingDate, poIsFutureVsServer]);

  function updateRow(id: string, patch: Partial<GrnLineRow>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.itemId !== id) return row;
        const next = { ...row, ...patch };
        if ("received_qty" in patch || "rejected_qty" in patch) {
          const received = next.received_qty;
          const rejected = Math.min(next.rejected_qty, received);
          next.rejected_qty = rejected;
          next.accepted_qty = Math.max(0, received - rejected);
        }
        return next;
      })
    );
    setFieldErrors((prev) => ({ ...prev, lines: undefined }));
  }

  function validateStep(targetStep: number): boolean {
    const errors: FieldErrors = {};

    if (targetStep >= 1) {
      if (!warehouse) errors.warehouse = "Choose a target warehouse.";
      const lineErrors: Record<string, string> = {};
      const activeLines = rows.filter((row) => row.received_qty > 0);
      if (activeLines.length === 0) {
        errors.submit = "Enter received quantity for at least one line item.";
      }
      for (const row of activeLines) {
        if (row.received_qty > row.pending_qty) {
          lineErrors[row.itemId] = `Cannot receive more than the remaining ${row.pending_qty} pending on this PO line.`;
        }
        if (row.rejected_qty > 0 && !row.rejection_reason) {
          lineErrors[row.itemId] = "Select a rejection reason when quantity is rejected.";
        }
        if (row.accepted_qty + row.rejected_qty !== row.received_qty) {
          lineErrors[row.itemId] = "Accepted + rejected must equal received quantity.";
        }
      }
      if (Object.keys(lineErrors).length) errors.lines = lineErrors;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function goNext() {
    if (!validateStep(step + 1)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleAttachmentChange(fileList: FileList | null) {
    if (!fileList) return;
    const next = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}`,
      file,
    }));
    setAttachments((prev) => [...prev, ...next]);
  }

  /**
   * Resolve the Posting Date fields to send to ERPNext.
   *
   * ERPNext enforces BOTH rules against its OWN clock: posting date ≤
   * `frappe.utils.today()` (no future date) AND posting date ≥ the linked
   * Purchase Order date. The client machine date is never authoritative.
   *
   * So by default we send NOTHING — ERPNext stamps its own `today()`, which is
   * guaranteed to satisfy the "not future" rule and (for any non-future PO) the
   * PO-date rule too. We only send an explicit `posting_date` when the user
   * deliberately backdates, pinned to `00:00:00` and floored at the PO date.
   */
  function resolvePostingFields(): Partial<
    Pick<PurchaseReceipt, "posting_date" | "posting_time" | "set_posting_time">
  > {
    let fields: Partial<
      Pick<PurchaseReceipt, "posting_date" | "posting_time" | "set_posting_time">
    > = {};

    if (postingDateTouched && postingDate) {
      const clamped =
        poPostingDate && postingDate < poPostingDate ? poPostingDate : postingDate;
      const isoDate = formatERPNextDate(clamped) ?? clamped;
      fields = {
        posting_date: isoDate,
        posting_time: "00:00:00",
        set_posting_time: 1,
      };
    }

    // eslint-disable-next-line no-console
    console.log("[GRN Posting Date]", {
      erpServerDate:
        serverDateQuery.data ?? "(unresolved — ERPNext today() will apply)",
      browserDate: todayIso(),
      purchaseOrderDate: poPostingDate || "(unknown)",
      selectedPostingDate: postingDateTouched ? postingDate : "(none selected)",
      payloadPostingDate:
        fields.posting_date ?? "(omitted — ERPNext stamps today())",
    });

    return fields;
  }

  function buildPayload(): Partial<PurchaseReceipt> {
    if (!selectedPO) throw new Error("Purchase Order not loaded.");

    const rejectionNotes = rows
      .filter((row) => row.rejected_qty > 0)
      .map(
        (row) =>
          `${row.item_code}: ${row.rejected_qty} rejected (${row.rejection_reason})${
            row.batch_no ? ` batch ${row.batch_no}` : ""
          }`
      )
      .join("; ");

    const combinedRemarks = [notes.trim(), rejectionNotes].filter(Boolean).join("\n\n");

    const postingFields = resolvePostingFields();

    return {
      supplier: selectedPO.supplier,
      ...postingFields,
      company: selectedPO.company || COMPANY,
      currency: selectedPO.currency,
      remarks: combinedRemarks || undefined,
      items: rows
        .filter((row) => row.received_qty > 0)
        .map((row) => ({
          name: row.po_item || row.itemId,
          item_code: row.item_code,
          item_name: row.item_name,
          qty: row.accepted_qty,
          received_qty: row.received_qty,
          rejected_qty: row.rejected_qty,
          rate: row.rate,
          uom: row.uom,
          warehouse: row.warehouse || warehouse,
          purchase_order: selectedPO.name,
          purchase_order_item: row.po_item,
          batch_no: row.batch_no || undefined,
          amount: row.accepted_qty * row.rate,
        })),
    };
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      // Requirement: print the EXACT payload sent to ERPNext + the dates used.
      /* eslint-disable no-console */
      console.log("[GRN Submit] Dates", {
        erpServerDate:
          serverDateQuery.data ?? "(unresolved — ERPNext today() will apply)",
        browserDate: todayIso(),
        purchaseOrderDate: poPostingDate || "(unknown)",
        selectedPostingDate: postingDateTouched ? postingDate : "(none selected)",
        payloadPostingDate:
          payload.posting_date ?? "(omitted — ERPNext stamps today())",
      });
      console.log(
        "[GRN Submit] Exact payload sent to ERPNext:\n" +
          JSON.stringify(payload, null, 2),
      );
      /* eslint-enable no-console */
      const draft = await createPurchaseReceipt(payload);
      // ERPNext echoes back the posting_date it actually stamped (== today()).
      // eslint-disable-next-line no-console
      console.log("[GRN Submit] ERPNext stamped posting_date =", draft.posting_date);
      for (const entry of attachments) {
        await uploadFileToERPNext(entry.file, "Purchase Receipt", draft.name);
      }
      const submitted = await submitPurchaseReceipt(draft.name);
      // ERPNext updates Bin stock synchronously on submit, so on-hand stock is
      // already live here. Advance any procurement MR whose forwarded quantity
      // is now fully received from "Procurement Required" → "Ready to Issue".
      // Best-effort: a reconciliation failure must never fail the receipt.
      try {
        await reconcileProcurementReadyToIssue();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[GRN submit] Ready-to-Issue reconciliation skipped:", err);
      }
      return submitted;
    },
    onSuccess: (grn) => {
      setSubmittedGrnName(grn.name);
      toast.success("Goods Receipt created successfully.");
      // Refresh every live-stock, inventory, GRN and procurement view so the
      // received quantities (and any MR moved to Ready to Issue) show instantly
      // — all read live from ERPNext Bin, no page reload needed.
      invalidateWarehouseStock(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["purchase-order", poName] });
    },
    onError: (err: unknown) => {
      // A posting-date conflict (future date / before PO) is a server-date vs
      // PO-date mismatch — explain it clearly. Everything else surfaces the real
      // ERPNext message. The full exception is always logged to the console.
      // eslint-disable-next-line no-console
      console.error("[GRN Submit] error:", err);
      const message = isDateConflictError(err)
        ? grnDateConflictMessage(serverDateQuery.data, poPostingDate)
        : friendlyGrnError(err);
      setFieldErrors((prev) => ({ ...prev, submit: message }));
      toast.error(message);
    },
  });

  function handleSubmit() {
    if (!validateStep(STEPS.length - 1)) return;
    // Never send a request ERPNext is guaranteed to reject: the PO is dated
    // after the server's own today().
    if (poIsFutureVsServer) {
      setFieldErrors((prev) => ({ ...prev, submit: PO_FUTURE_MESSAGE }));
      toast.error(PO_FUTURE_MESSAGE);
      return;
    }
    // A GRN posting date can never be earlier than the Purchase Order date.
    if (postingDateTouched && poPostingDate && postingDate < poPostingDate) {
      setPostingDate(defaultPostingDate);
      setPostingDateTouched(false);
      setFieldErrors((prev) => ({ ...prev, submit: PO_DATE_MESSAGE }));
      toast.error(PO_DATE_MESSAGE);
      return;
    }
    submitMutation.mutate();
  }

  function startReceiving(targetPoName: string) {
    setPoName(targetPoName);
    setStep(0);
    setWarehouse("");
    // Reset to untouched — the effect re-derives max(server today, PO date)
    // once the selected PO loads.
    setPostingDate(defaultPostingDate);
    setPostingDateTouched(false);
    setRows([]);
    setNotes("");
    setAttachments([]);
    setFieldErrors({});
    setSubmittedGrnName(null);
    setWizardActive(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("po", targetPoName);
        return next;
      },
      { replace: false }
    );
  }

  function exitWizard(nextTab?: ListTab) {
    setWizardActive(false);
    setPoName("");
    setStep(0);
    setRows([]);
    setAttachments([]);
    setNotes("");
    setSubmittedGrnName(null);
    setFieldErrors({});
    // Combine the "po" removal and the "tab" switch into a single URL update
    // (rather than calling `useTabParam`'s setter separately) so the second
    // write can't silently resurrect the just-removed "po" param from a
    // stale params snapshot.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("po");
        if (nextTab) {
          if (nextTab === "upcoming") next.delete("tab");
          else next.set("tab", nextTab);
        }
        return next;
      },
      { replace: false }
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Success screen                                                         */
  /* ---------------------------------------------------------------------- */

  if (submittedGrnName) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">GRN Created Successfully</h1>
          <p className="mt-2 text-sm text-slate-500">
            Goods receipt <span className="font-semibold text-slate-800">{submittedGrnName}</span>{" "}
            was submitted. Accepted quantities have been posted to inventory and the linked PO
            receipt status has been updated.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/p2p/grn/${encodeURIComponent(submittedGrnName)}`)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              View GRN
            </button>
            <button
              type="button"
              onClick={() => exitWizard("history")}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Go to GRN History
            </button>
            <button
              type="button"
              onClick={() => exitWizard("upcoming")}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Receive Another Delivery
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Receive wizard                                                         */
  /* ---------------------------------------------------------------------- */

  if (wizardActive) {
    const listFailed = poQuery.isError || warehousesQuery.isError;

    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => exitWizard()}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to GRN List
          </button>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Receive Goods</h1>
          <p className="text-sm text-slate-500">
            Record goods received against{" "}
            <span className="font-semibold text-slate-700">{poName}</span>, including accepted
            and rejected quantities.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${stepClass(step === index, step > index)}`}
            >
              Step {index + 1}: {label}
            </div>
          ))}
        </div>

        {listFailed && (
          <ErrorState
            title="Unable to load GRN prerequisites"
            description="The purchase order or warehouses could not be loaded from ERPNext."
            onRetry={() => {
              void poQuery.refetch();
              void warehousesQuery.refetch();
            }}
          />
        )}

        {poIsFutureVsServer && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" />
            <div className="text-sm">
              <p className="font-semibold text-rose-800">{PO_FUTURE_MESSAGE}</p>
              <p className="mt-0.5 text-rose-700">
                Purchase Order date{" "}
                <span className="font-semibold">{formatDate(poPostingDate)}</span> is
                after the ERPNext server date{" "}
                <span className="font-semibold">
                  {formatDate(serverDateQuery.data ?? "")}
                </span>
                . Goods can't be received until the server reaches the PO date.
                This usually means the ERPNext server clock/timezone (or the PO
                date) needs to be corrected. Submission is disabled to prevent an
                invalid request.
              </p>
            </div>
          </div>
        )}

        {step === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            {poQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading purchase order…
              </div>
            ) : selectedPO ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{selectedPO.name}</p>
                  <p className="mt-1 text-slate-600">
                    Supplier: {selectedPO.supplier_name ?? selectedPO.supplier}
                  </p>
                  <p className="text-slate-600">
                    Expected items: {(selectedPO.items ?? []).length}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => exitWizard("upcoming")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Change PO
                </button>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Target Warehouse
                </label>
                <select
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Select warehouse…</option>
                  {(warehousesQuery.data ?? []).map((wh) => (
                    <option key={wh.name} value={wh.name}>
                      {wh.warehouse_name ?? wh.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.warehouse && (
                  <p className="mt-1 text-sm text-rose-600">{fieldErrors.warehouse}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Posting Date
                </label>
                <input
                  type="date"
                  value={postingDate}
                  min={pickerMin}
                  max={pickerMax}
                  onChange={(e) => {
                    let value = e.target.value;
                    setPostingDateTouched(true);
                    // Clamp to the allowed range: never before the PO date, and
                    // never beyond the ceiling (server today / PO date).
                    if (pickerMin && value < pickerMin) value = pickerMin;
                    if (value > pickerMax) value = pickerMax;
                    setPostingDate(value);
                    setFieldErrors((prev) => ({ ...prev, submit: undefined }));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {poPostingDate
                    ? `Cannot be earlier than the PO date (${formatDate(poPostingDate)}).`
                    : "Defaults to today's date. Future dates are not allowed."}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <h2 className="text-lg font-semibold text-slate-900">Match Received Items</h2>
              {hasDiscrepancy && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Quantity discrepancies flagged
                </span>
              )}
            </div>

            {poQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading PO line items…
              </div>
            ) : poQuery.isError ? null : (
              <>
                {(fieldErrors.submit || fieldErrors.lines) && (
                  <p className="text-sm text-rose-600">
                    {fieldErrors.submit ?? "Fix line item errors before continuing."}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-3 pr-3">Item</th>
                        <th className="py-3 px-2 text-right">Ordered</th>
                        <th className="py-3 px-2 text-right">Pending</th>
                        <th className="py-3 px-2 text-right">Received</th>
                        <th className="py-3 px-2 text-right">Accepted</th>
                        <th className="py-3 px-2 text-right">Rejected</th>
                        <th className="py-3 px-2">Rejection Reason</th>
                        <th className="py-3 px-2">Batch</th>
                        <th className="py-3 pl-2">Expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row) => {
                        const discrepancy =
                          row.received_qty > 0 && row.received_qty !== row.pending_qty;
                        const lineError = fieldErrors.lines?.[row.itemId];
                        return (
                          <tr key={row.itemId} className={discrepancy ? "bg-amber-50/40" : undefined}>
                            <td className="py-3 pr-3">
                              <p className="font-medium text-slate-900">{row.item_name ?? row.item_code}</p>
                              <p className="text-xs text-slate-400">{row.item_code}</p>
                              {lineError && <p className="text-xs text-rose-600 mt-1">{lineError}</p>}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums">{row.ordered_qty}</td>
                            <td className="py-3 px-2 text-right tabular-nums">{row.pending_qty}</td>
                            <td className="py-3 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={row.pending_qty}
                                step="any"
                                value={row.received_qty || ""}
                                onChange={(e) =>
                                  updateRow(row.itemId, {
                                    received_qty: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-20 rounded border border-slate-200 px-2 py-1 text-right"
                              />
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums">{row.accepted_qty}</td>
                            <td className="py-3 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={row.rejected_qty || ""}
                                onChange={(e) =>
                                  updateRow(row.itemId, {
                                    rejected_qty: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-20 rounded border border-slate-200 px-2 py-1 text-right"
                              />
                            </td>
                            <td className="py-3 px-2">
                              <select
                                value={row.rejection_reason}
                                onChange={(e) =>
                                  updateRow(row.itemId, {
                                    rejection_reason: e.target.value as RejectionReason | "",
                                  })
                                }
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                                disabled={row.rejected_qty <= 0}
                              >
                                <option value="">—</option>
                                {REJECTION_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {reason}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-3 px-2">
                              <input
                                type="text"
                                value={row.batch_no}
                                onChange={(e) => updateRow(row.itemId, { batch_no: e.target.value })}
                                className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="py-3 pl-2">
                              <input
                                type="date"
                                value={row.expiry_date}
                                onChange={(e) =>
                                  updateRow(row.itemId, { expiry_date: e.target.value })
                                }
                                className="rounded border border-slate-200 px-2 py-1 text-xs"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Attachments & Notes</h2>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Warehouse Remarks
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Delivery condition, carrier reference, damage notes…"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Supporting Documents
              </label>
              <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 hover:bg-slate-100">
                <Upload className="mb-2 h-5 w-5" />
                Upload delivery challan, photos, or inspection reports
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => handleAttachmentChange(e.target.files)}
                />
              </label>
              {attachments.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {attachments.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span>{entry.file.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => prev.filter((a) => a.id !== entry.id))
                        }
                        className="text-xs font-semibold text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Review & Submit</h2>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Purchase Order</p>
                <p className="font-semibold text-slate-900">{poName}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Warehouse</p>
                <p className="font-semibold text-slate-900">{warehouse}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 text-left">Item</th>
                    <th className="py-2 text-right">Received</th>
                    <th className="py-2 text-right">Accepted</th>
                    <th className="py-2 text-right">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((row) => row.received_qty > 0)
                    .map((row) => (
                      <tr key={row.itemId} className="border-b border-slate-100">
                        <td className="py-2">{row.item_code}</td>
                        <td className="py-2 text-right tabular-nums">{row.received_qty}</td>
                        <td className="py-2 text-right tabular-nums">{row.accepted_qty}</td>
                        <td className="py-2 text-right tabular-nums">{row.rejected_qty}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {notes && (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Remarks</p>
                {notes}
              </div>
            )}
            {attachments.length > 0 && (
              <p className="text-sm text-slate-600">
                {attachments.length} attachment{attachments.length === 1 ? "" : "s"} will be uploaded
                after the GRN is created.
              </p>
            )}
            {fieldErrors.submit && (
              <p className="text-sm text-rose-600">{fieldErrors.submit}</p>
            )}
          </section>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0 || submitMutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitMutation.isPending || poIsFutureVsServer}
              title={poIsFutureVsServer ? PO_FUTURE_MESSAGE : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <PackagePlus className="h-4 w-4" />
                  Submit GRN
                </>
              )}
            </button>
          )}
        </div>

        {submitMutation.isPending && (
          <p className="text-center text-xs text-slate-500">
            Creating and submitting GRN in ERPNext…
          </p>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  List view — Upcoming Deliveries / GRN History tabs                     */
  /* ---------------------------------------------------------------------- */

  const tabDefs: TabDef<ListTab>[] = [
    { id: "upcoming", label: "Upcoming Deliveries", count: deliveries.length },
    { id: "history", label: "GRN History", count: grnRows.length },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Goods Receipt"
        description="Track inbound purchase orders awaiting receipt and review completed goods receipt notes."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Truck}
          label="Upcoming Deliveries"
          value={deliveries.length}
          loading={incomingQuery.isLoading}
          tone="primary"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed GRNs"
          value={grnRows.length}
          loading={grnHistoryQuery.isLoading}
          tone="accent"
        />
        <StatCard
          icon={Clock}
          label="Pending Receipts"
          value={receivingKpis.incomingThisWeek}
          loading={incomingQuery.isLoading}
          tone="warning"
          sub="Due within 7 days"
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue Deliveries"
          value={receivingKpis.overdueDeliveries}
          loading={incomingQuery.isLoading}
          tone="danger"
        />
      </div>

      <Tabs tabs={tabDefs} active={tab} onChange={setTab} />

      {tab === "upcoming" ? (
        <section className="space-y-3">
          <FilterBar>
            <FilterField label="Search" className="min-w-[240px] flex-1">
              <SearchInput
                value={upcomingSearch}
                onChange={setUpcomingSearch}
                placeholder="PO number or supplier…"
              />
            </FilterField>
          </FilterBar>

          <div className="table-shell min-w-0">
            {incomingQuery.isLoading ? (
              <TableSkeleton rows={6} columns={6} />
            ) : incomingQuery.isError ? (
              <ErrorState
                title="Could not load purchase orders"
                description="Purchase orders awaiting receipt could not be loaded from ERPNext."
                onRetry={() => void incomingQuery.refetch()}
              />
            ) : filteredDeliveries.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No upcoming deliveries"
                description="All approved purchase orders have been received."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Supplier</th>
                      <th>Expected Date</th>
                      <th>Due Status</th>
                      <th className="text-right">Total Amount</th>
                      {canAct && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeliveries.map((d) => {
                      const meta = DELIVERY_URGENCY_META[d.urgency];
                      return (
                        <tr key={d.name}>
                          <td>
                            <span className="table-link">{d.name}</span>
                          </td>
                          <td className="text-neutral-600">
                            {d.supplier_name ?? d.supplier ?? "—"}
                          </td>
                          <td className="text-neutral-600">
                            {d.schedule_date ? formatDate(d.schedule_date) : "—"}
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="text-right font-medium tabular-nums">
                            {formatCurrency(d.grand_total)}
                          </td>
                          {canAct && (
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => startReceiving(d.name)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
                              >
                                <PackagePlus className="h-3.5 w-3.5" />
                                Receive Goods
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <FilterBar>
            <FilterField label="Search" className="min-w-[220px] flex-1">
              <SearchInput
                value={historySearch}
                onChange={setHistorySearch}
                placeholder="GRN number or supplier…"
              />
            </FilterField>
            <FilterField label="Status" className="min-w-[150px]">
              <select
                value={historyStatus}
                onChange={(e) =>
                  setHistoryStatus(e.target.value as PurchaseReceiptStatus | "")
                }
                className="select-field"
              >
                {GRN_STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt || "All statuses"}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Supplier" className="min-w-[170px]">
              <select
                value={historySupplier}
                onChange={(e) => setHistorySupplier(e.target.value)}
                className="select-field"
              >
                <option value="">All suppliers</option>
                {supplierOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="From Date" className="min-w-[140px]">
              <input
                type="date"
                value={historyDateFrom}
                onChange={(e) => setHistoryDateFrom(e.target.value)}
                className="select-field"
              />
            </FilterField>
            <FilterField label="To Date" className="min-w-[140px]">
              <input
                type="date"
                value={historyDateTo}
                onChange={(e) => setHistoryDateTo(e.target.value)}
                className="select-field"
              />
            </FilterField>
            {historyFiltersActive && (
              <button
                type="button"
                onClick={clearHistoryFilters}
                className="self-end whitespace-nowrap text-xs font-semibold text-primary-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </FilterBar>

          <div className="table-shell min-w-0">
            {grnHistoryQuery.isLoading ? (
              <TableSkeleton rows={6} columns={7} />
            ) : grnHistoryQuery.isError ? (
              <ErrorState
                title="Could not load goods receipts"
                description="Completed goods receipt notes could not be loaded from ERPNext."
                onRetry={() => void grnHistoryQuery.refetch()}
              />
            ) : filteredHistoryRows.length === 0 ? (
              <EmptyState
                icon={Search}
                title={grnRows.length === 0 ? "No goods receipts yet" : "No matching goods receipts"}
                description={
                  grnRows.length === 0
                    ? "Receive goods against an open PO to create a GRN."
                    : "Try adjusting your search or filters."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>GRN Number</th>
                      <th>Supplier</th>
                      <th>Posting Date</th>
                      <th>Status</th>
                      <th className="text-right">Received Qty</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">View</th>
                      <th className="text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryRows.map((g: PurchaseReceipt) => (
                      <tr key={g.name}>
                        <td>
                          <span className="table-link">{g.name}</span>
                        </td>
                        <td className="text-neutral-600">
                          {g.supplier_name ?? g.supplier}
                        </td>
                        <td className="text-neutral-600">
                          {formatDate(g.posting_date)}
                        </td>
                        <td>
                          <StatusBadge status={g.status ?? "Draft"} />
                        </td>
                        <td className="text-right tabular-nums text-neutral-600">
                          {g.total_qty != null
                            ? new Intl.NumberFormat("en-US").format(g.total_qty)
                            : "—"}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {formatCurrency(g.grand_total)}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => navigate(`/p2p/grn/${encodeURIComponent(g.name)}`)}
                            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white p-1.5 text-neutral-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                            title="View GRN"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        <td className="text-right">
                          <PdfActions
                            variant="compact"
                            showView={false}
                            className="justify-end"
                            filename={grnPdfFilename(g)}
                            build={async () => {
                              const full = await getPurchaseReceipt(g.name);
                              return buildGrnPdf(full, full.status ?? g.status ?? "Draft");
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
