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
  PackageCheck,
  PackagePlus,
  Search,
  Truck,
  Upload,
} from "lucide-react";

import {
  apiGet,
  COMPANY,
  fetchErpServerDateInfo,
  fetchServerDate,
  withSilent,
} from "../../api/erpnext";
import { uploadFileToERPNext } from "../../api/legalDocsStorage";
import {
  createPurchaseReceipt,
  getGRNsForPO,
  getIncomingPurchaseOrders,
  getPurchaseOrder,
  getPurchaseReceipt,
  getPurchaseReceipts,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import { invalidateWarehouseStock } from "../../api/warehouseStock";
import { reconcileProcurementReadyToIssue } from "../../api/materialRequestWorkflow";
import { advancePoWorkflowAfterGrnSubmit } from "../../api/poDeliveryWorkflow";
import { getInvoicesForPO } from "../../api/accounts";
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
import { formatCurrency, formatDate, formatDateTime, todayIso } from "../../utils/format";
import {
  formatGrnPostingDateMessage,
  isGrnPostingDateFuture,
  logGrnPostingDateDebug,
  normalizeGrnPostingDate,
  resolveGrnPostingDate,
  toCalendarYmd,
  todayERPNextDate,
} from "../../utils/erpNextDate";
import {
  buildUpcomingDeliveries,
  computeReceivingKpis,
  DELIVERY_URGENCY_META,
  resolveReceiveAction,
} from "../../utils/upcomingDeliveries";
import type { PurchaseReceipt, PurchaseReceiptStatus } from "../../types/erpnext";
import WarehouseReviewSignPanel from "../../components/warehouse/esign/WarehouseReviewSignPanel";
import {
  appendWarehouseEsignAudit,
  buildWarehouseEsignErpFields,
  finalizeWarehouseSignatureForReview,
  fetchWarehouseSignerProfile,
  hasReviewSignatureReady,
  persistWarehouseGrnDigitalSignature,
  restampSignedGrnPdfUrl,
  validateWarehouseEsignForSubmit,
} from "../../api/warehouseEsign";
import {
  createInitialWarehouseEsignState,
  type WarehouseEsignState,
} from "../../types/warehouseEsign";

const REQUEST_TIMEOUT_MS = 5_000;
const STEPS = [
  "Receive Items",
  "Attachments",
  "Review & Submit",
] as const;

/** True when a GRN failure is a posting-date conflict from ERPNext. */
function isDateConflictError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return /future date|cannot be before Purchase Order date|posting date/i.test(raw);
}

/**
 * Surface ERPNext's human message when available; never show raw tracebacks.
 * Posting-date conflicts are left to ERPNext — we do not invent a second client gate.
 */
function friendlyGrnError(err: unknown): string {
  // eslint-disable-next-line no-console
  console.error("[GRN submit] failed:", err);
  const raw =
    err instanceof Error ? (err.message ?? "").trim() : String(err ?? "").trim();
  if (
    /UpdateAfterSubmitError/i.test(raw) ||
    /Not allowed to change .+ after submission/i.test(raw) ||
    /Warehouse E-Sign Envelope/i.test(raw)
  ) {
    return "The GRN has already been finalized.";
  }
  const isOpaque =
    !raw ||
    /^request failed$/i.test(raw) ||
    /Traceback \(most recent call last\)/i.test(raw) ||
    /frappe\.exceptions/i.test(raw);
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
  /** Cumulative qty already received on the PO line (ERPNext `received_qty`). */
  already_received_qty: number;
  /** Remaining receivable qty from ERP: max(0, ordered − already_received). */
  pending_qty: number;
  /** Qty being received on *this* GRN session (user input). */
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
  const authUser = useAuthStore((s) => s.user);
  const role = authUser?.role;
  const canAct = canCreateGRN(role);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialPO = searchParams.get("po") ?? "";

  const [tab, setTab] = useTabParam<ListTab>("upcoming");
  const [wizardActive, setWizardActive] = useState(!!initialPO);

  const [step, setStep] = useState(0);
  const [poName, setPoName] = useState(initialPO);
  const [warehouse, setWarehouse] = useState("");
  const [postingDate, setPostingDate] = useState(todayERPNextDate());
  /** Tracks whether the user changed the date picker (value still sent as YYYY-MM-DD). */
  const [postingDateTouched, setPostingDateTouched] = useState(false);
  const [rows, setRows] = useState<GrnLineRow[]>([]);
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submittedGrnName, setSubmittedGrnName] = useState<string | null>(null);
  const [esign, setEsign] = useState<WarehouseEsignState>(() =>
    createInitialWarehouseEsignState({
      fullName: "",
      designation: "Warehouse Manager",
    }),
  );

  /* Prefill Warehouse Manager identity for E-Sign */
  useEffect(() => {
    const fullName = authUser?.full_name || authUser?.email || "";
    if (!fullName) return;
    let cancelled = false;
    void (async () => {
      const profile = await fetchWarehouseSignerProfile(authUser?.name || "");
      if (cancelled) return;
      setEsign((prev) => ({
        ...prev,
        fullName: prev.fullName || fullName,
        typedName: prev.typedName || fullName,
        designation: prev.designation || profile.designation,
        employeeId: prev.employeeId || profile.employeeId,
        role: prev.role || "Warehouse Manager",
        email: prev.email || authUser?.email || "",
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser?.full_name, authUser?.email, authUser?.name]);

  /* ---------------------------------------------------------------------- */
  /*  Upcoming Deliveries — shared by the tab list and the receive wizard    */
  /* ---------------------------------------------------------------------- */

  const incomingQuery = useQuery({
    queryKey: ["incoming-purchase-orders"],
    queryFn: getIncomingPurchaseOrders,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // ERP site calendar today in System Settings time zone (not UTC).
  const serverDateQuery = useQuery({
    queryKey: ["erpnext-server-date"],
    queryFn: fetchErpServerDateInfo,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const erpToday = serverDateQuery.data?.today ?? null;
  /** List KPIs still need a stable YYYY-MM-DD; prefer ERP today. */
  const serverToday = erpToday ?? todayIso();

  const deliveries = useMemo(
    () => buildUpcomingDeliveries(incomingQuery.data ?? []),
    [incomingQuery.data]
  );

  const [upcomingSearch, setUpcomingSearch] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterShipmentStatus, setFilterShipmentStatus] = useState("");
  const [filterEta, setFilterEta] = useState("");
  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterTracking, setFilterTracking] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const debouncedUpcomingSearch = useDebounce(upcomingSearch, 300);

  const upcomingSupplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deliveries) {
      const s = d.supplier_name ?? d.supplier;
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deliveries]);

  const upcomingWarehouseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deliveries) {
      if (d.set_warehouse) set.add(d.set_warehouse);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deliveries]);

  const shipmentStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deliveries) {
      if (d.shipment_status) set.add(String(d.shipment_status));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deliveries]);

  const filteredDeliveries = useMemo(() => {
    const q = debouncedUpcomingSearch.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (filterOverdueOnly && d.urgency !== "overdue") return false;
      if (filterSupplier) {
        const s = d.supplier_name ?? d.supplier ?? "";
        if (s !== filterSupplier) return false;
      }
      if (filterShipmentStatus) {
        // Empty shipment_status = historical PO; match filter "Pending Acceptance"
        // only when that option is chosen — never hide by default.
        const status = String(d.shipment_status || "").trim() || "Pending Acceptance";
        if (status !== filterShipmentStatus) {
          return false;
        }
      }
      if (filterEta && d.displayExpectedDate !== filterEta) return false;
      if (filterVehicle) {
        if (!(d.vehicle_number || "").toLowerCase().includes(filterVehicle.toLowerCase())) {
          return false;
        }
      }
      if (filterTracking) {
        if (!(d.tracking_number || "").toLowerCase().includes(filterTracking.toLowerCase())) {
          return false;
        }
      }
      if (filterWarehouse && d.set_warehouse !== filterWarehouse) return false;
      if (!q) return true;
      const supplier = (d.supplier_name ?? d.supplier ?? "").toLowerCase();
      const vehicle = (d.vehicle_number || "").toLowerCase();
      const tracking = (d.tracking_number || "").toLowerCase();
      return (
        d.name.toLowerCase().includes(q) ||
        supplier.includes(q) ||
        vehicle.includes(q) ||
        tracking.includes(q)
      );
    });
  }, [
    deliveries,
    debouncedUpcomingSearch,
    filterSupplier,
    filterShipmentStatus,
    filterEta,
    filterVehicle,
    filterTracking,
    filterWarehouse,
    filterOverdueOnly,
  ]);

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

  const deliveredTodayCount = useMemo(
    () => grnRows.filter((g) => g.posting_date === serverToday).length,
    [grnRows, serverToday],
  );

  const receivingKpis = useMemo(
    () =>
      computeReceivingKpis(deliveries, {
        serverToday,
        completedGrnTodayCount: deliveredTodayCount,
      }),
    [deliveries, serverToday, deliveredTodayCount],
  );

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
    enabled: !!poName && wizardActive,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
  });

  /** Existing Purchase Receipts for this PO — used when pending is already 0. */
  const existingGrnsQuery = useQuery({
    queryKey: ["grns-for-po", poName],
    queryFn: () => getGRNsForPO(poName),
    enabled: !!poName && wizardActive,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  useEffect(() => {
    const po = poQuery.data;
    if (!po) {
      setRows([]);
      return;
    }
    // Pending qty is derived exclusively from live ERP PO lines — never from
    // localStorage or a previous wizard session.
    setRows(
      (po.items ?? []).map((it) => {
        const ordered = Number(it.qty) || 0;
        const alreadyReceived = Number(it.received_qty) || 0;
        const pending = Math.max(0, ordered - alreadyReceived);
        return {
          itemId: it.name ?? `${it.item_code}-${ordered}`,
          item_code: it.item_code,
          item_name: it.item_name,
          ordered_qty: ordered,
          already_received_qty: alreadyReceived,
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
  }, [poQuery.dataUpdatedAt, poQuery.data]);

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

  const submittedGrnsForPo = useMemo(
    () => (existingGrnsQuery.data ?? []).filter((g) => g.docstatus === 1),
    [existingGrnsQuery.data],
  );
  const primaryExistingGrn = submittedGrnsForPo[0];

  /** True when ERP reports nothing left to receive (do not allow a new GRN). */
  const isFullyReceivedFromErp = useMemo(() => {
    if (!selectedPO) return false;
    if ((selectedPO.per_received ?? 0) >= 100) return true;
    if (rows.length === 0) return false;
    return rows.every((r) => r.pending_qty <= 0);
  }, [selectedPO, rows]);

  // PO / calendar days as YYYY-MM-DD only (never UTC / Date serialization).
  const poPostingDate =
    toCalendarYmd(selectedPO?.transaction_date) ?? "";
  const localToday = todayERPNextDate();
  // Default = PO posting date (not today). Single source: normalizeGrnPostingDate.
  const postingResolution = useMemo(
    () =>
      normalizeGrnPostingDate({
        selected: postingDateTouched ? postingDate : null,
        poDate: poPostingDate || null,
        erpToday,
        browserToday: localToday,
      }),
    [
      postingDateTouched,
      postingDate,
      poPostingDate,
      erpToday,
      localToday,
    ],
  );
  const defaultPostingDate = resolveGrnPostingDate(
    poPostingDate || null,
    erpToday,
    localToday,
  );
  const pickerMin = postingResolution.floor || undefined;
  const pickerMax = postingResolution.invalidWindow
    ? postingResolution.floor || postingResolution.ceiling
    : postingResolution.ceiling;

  // Keep the (untouched) display value = PO date when Create GRN opens.
  useEffect(() => {
    if (!postingDateTouched) {
      setPostingDate(defaultPostingDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPostingDate, postingDateTouched]);

  // When ERP today arrives: clamp user picks that are truly in the future,
  // but never pull an untouched PO default down below the PO date.
  useEffect(() => {
    if (!erpToday || !postingDate || !postingDateTouched) return;
    if (!isGrnPostingDateFuture(postingDate, erpToday, localToday)) return;
    const next = normalizeGrnPostingDate({
      selected: postingDate,
      poDate: poPostingDate || null,
      erpToday,
      browserToday: localToday,
    });
    if (next.postingDate !== postingDate && next.clampedToErpToday) {
      setPostingDate(next.postingDate);
      toast(
        formatGrnPostingDateMessage("future_blocked", {
          poDate: poPostingDate,
          selectedDate: postingDate,
          today: erpToday,
          adjustedDate: next.postingDate,
        }),
        { icon: "ℹ️" },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erpToday]);

  useEffect(() => {
    if (!poName) return;
    const info = serverDateQuery.data;
    /* eslint-disable no-console */
    console.group("[GRN Date Validation]");
    console.log("Browser Date:", localToday);
    console.log("Server Date:", info?.today ?? erpToday ?? "(unresolved)");
    console.log("ERP Today:", erpToday ?? "(unresolved)");
    console.log("UTC Today:", info?.utcToday ?? "(n/a)");
    console.log("ERP Time Zone:", info?.timeZone ?? "(n/a)");
    console.log(
      "System Settings Time Zone:",
      info?.systemSettingsTimeZone ?? "(n/a)",
    );
    console.log("PO Date:", poPostingDate || "(unknown)");
    console.log("Posting Date:", postingDate);
    console.log(
      "Comparison:",
      `PO(${poPostingDate || "?"}) <= Today(${erpToday || "?"}) && ` +
        `Posting(${postingDate}) >= PO && Posting <= Today`,
    );
    console.log(
      "Result:",
      postingResolution.invalidWindow
        ? "INVALID WINDOW (PO after ERP today — check time zone)"
        : postingResolution.clampedToPoDate
          ? "ADJUSTED TO PO DATE"
          : postingResolution.wouldBeFuture
            ? "FUTURE → clamp to today"
            : "ALLOWED",
    );
    console.groupEnd();
    /* eslint-enable no-console */
    logGrnPostingDateDebug({
      browserDate: localToday,
      selectedDate: postingDate,
      payloadDate: postingResolution.postingDate,
      serverDate: erpToday,
      erpToday,
      poDate: poPostingDate || null,
      comparisonResult: postingResolution.invalidWindow
        ? "INVALID WINDOW (PO after today)"
        : postingResolution.clampedToPoDate
          ? "ADJUSTED TO PO DATE"
          : postingResolution.wouldBeFuture
            ? "FUTURE → clamp to today"
            : "ALLOWED",
      resolution: postingResolution,
    });
  }, [
    poName,
    poPostingDate,
    erpToday,
    postingDate,
    postingDateTouched,
    localToday,
    postingResolution,
    serverDateQuery.data,
  ]);

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
      if (isFullyReceivedFromErp) {
        errors.submit = primaryExistingGrn
          ? `This Purchase Order is already fully received (${primaryExistingGrn.name}). Open the existing GRN instead of creating another.`
          : "This Purchase Order has no pending quantity. A GRN cannot be created.";
        setFieldErrors(errors);
        return false;
      }
      if (!warehouse) errors.warehouse = "Choose a target warehouse.";
      const lineErrors: Record<string, string> = {};
      const activeLines = rows.filter((row) => row.received_qty > 0);
      if (activeLines.length === 0) {
        errors.submit = "Enter received quantity for at least one line item.";
      }
      for (const row of activeLines) {
        if (row.received_qty > row.pending_qty) {
          lineErrors[row.itemId] =
            row.pending_qty <= 0
              ? `This line is already fully received (${row.already_received_qty} of ${row.ordered_qty}). Pending quantity is 0.`
              : `Cannot receive more than the remaining ${row.pending_qty} pending on this PO line.`;
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
    if (!validateStep(step + 1)) {
      return;
    }
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
   * Wire posting_date = YYYY-MM-DD only, clamped to [PO date, ERP today].
   * Never use Date / toISOString / UTC — ERP compares date portions via nowdate().
   */
  function resolvePostingFields(): Partial<
    Pick<PurchaseReceipt, "posting_date" | "set_posting_time">
  > {
    const localYmd = todayERPNextDate();
    const uiRaw =
      postingDateTouched && postingDate ? postingDate : defaultPostingDate;
    const resolution = normalizeGrnPostingDate({
      selected: uiRaw,
      poDate: poPostingDate || null,
      erpToday,
      browserToday: localYmd,
    });

    logGrnPostingDateDebug({
      browserDate: localYmd,
      selectedDate: postingDate,
      payloadDate: resolution.postingDate,
      serverDate: erpToday,
      erpToday,
      poDate: poPostingDate || null,
      comparisonResult: resolution.wouldBeFuture
        ? "BLOCKED future → clamped to ERP Today"
        : resolution.postingDate === resolution.ceiling
          ? "ALLOWED (Today)"
          : "ALLOWED (on or before Today)",
      resolution,
    });

    return {
      posting_date: resolution.postingDate,
      set_posting_time: 1,
    };
  }

  function buildPayload(
    signOverride?: WarehouseEsignState,
  ): Partial<PurchaseReceipt> {
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

    const signState = signOverride ?? esign;
    const esignSummary = signState.signatureHash
      ? [
          "— Warehouse Digital Signature —",
          `Signed by: ${signState.fullName}`,
          `Designation: ${signState.designation}`,
          `Employee ID: ${signState.employeeId || "—"}`,
          `Signed at: ${signState.signedAtIso || signState.signedAtDisplay}`,
          `SHA256: ${signState.signatureHash}`,
          signState.remarks ? `Inspection remarks: ${signState.remarks}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    const combinedRemarks = [notes.trim(), rejectionNotes, esignSummary]
      .filter(Boolean)
      .join("\n\n");

    const postingFields = resolvePostingFields();
    const esignFields = buildWarehouseEsignErpFields(signState);

    return {
      supplier: selectedPO.supplier,
      ...postingFields,
      company: selectedPO.company || COMPANY,
      currency: selectedPO.currency,
      remarks: combinedRemarks || undefined,
      ...esignFields,
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
      if (!hasReviewSignatureReady(esign) && !validateWarehouseEsignForSubmit(esign).ok) {
        throw new Error(
          "Warehouse Digital Signature is mandatory. Capture your signature and certify received goods.",
        );
      }

      // Ensure SHA-256 + placed flag are stamped from Review & Submit pad.
      let signedEsign = esign;
      if (!esign.signatureHash || !esign.placed) {
        signedEsign = await finalizeWarehouseSignatureForReview({
          ...esign,
          certified: true,
        });
        setEsign(signedEsign);
      }
      if (!signedEsign.certified || !signedEsign.signatureHash) {
        throw new Error(
          'Please capture a signature and confirm: "I certify received goods match this GRN".',
        );
      }

      // Refresh ERP today immediately before submit so TZ midnight edge cases
      // cannot use a stale ceiling from an earlier page load.
      let liveErpToday = erpToday;
      try {
        liveErpToday = (await fetchServerDate()) ?? erpToday;
      } catch {
        /* keep cached */
      }

      const liveResolution = normalizeGrnPostingDate({
        selected:
          postingDateTouched && postingDate ? postingDate : defaultPostingDate,
        poDate: poPostingDate || null,
        erpToday: liveErpToday,
        browserToday: todayERPNextDate(),
      });

      const payload = buildPayload(signedEsign);
      // Enforce live ceiling on the payload (buildPayload may have used cache).
      payload.posting_date = liveResolution.postingDate;
      payload.set_posting_time = 1;

      logGrnPostingDateDebug({
        browserDate: todayERPNextDate(),
        selectedDate: postingDate,
        payloadDate: payload.posting_date,
        serverDate: liveErpToday,
        erpToday: liveErpToday,
        poDate: poPostingDate || null,
        comparisonResult: liveResolution.wouldBeFuture
          ? "BLOCKED future → clamped to ERP Today"
          : liveResolution.postingDate === liveResolution.ceiling
            ? "ALLOWED (Today)"
            : "ALLOWED (on or before Today)",
        resolution: liveResolution,
      });

      /* eslint-disable no-console */
      console.log("[GRN Submit] Exact payload sent to ERPNext:\n" +
          JSON.stringify(
            {
              ...payload,
              warehouse_signature_data: payload.warehouse_signature_data
                ? `[${String(payload.warehouse_signature_data).length} chars]`
                : undefined,
              warehouse_esign_envelope: payload.warehouse_esign_envelope
                ? `[${String(payload.warehouse_esign_envelope).length} chars]`
                : undefined,
            },
            null,
            2,
          ),
      );
      /* eslint-enable no-console */

      let draft: PurchaseReceipt;
      try {
        draft = await createPurchaseReceipt(payload);
      } catch (err) {
        // Custom fields may not be provisioned yet — retry without them; hash stays in remarks.
        const message = err instanceof Error ? err.message : String(err);
        if (!/warehouse_|Custom Field|Unknown column|ValidationError|FieldNameError/i.test(message)) {
          throw err;
        }
        // eslint-disable-next-line no-console
        console.warn("[GRN Submit] Retrying without warehouse e-sign custom fields:", message);
        const rest: Partial<PurchaseReceipt> = { ...payload };
        delete rest.warehouse_signed;
        delete rest.warehouse_signed_by;
        delete rest.warehouse_signature_type;
        delete rest.warehouse_signature_data;
        delete rest.warehouse_signature_style;
        delete rest.warehouse_signature_hash;
        delete rest.warehouse_signed_at;
        delete rest.warehouse_ip;
        delete rest.warehouse_browser;
        delete rest.warehouse_device;
        delete rest.warehouse_esign_envelope;
        delete rest.warehouse_signer_role;
        delete rest.warehouse_signer_email;
        delete rest.warehouse_verification_status;
        delete rest.warehouse_document_version;
        delete rest.warehouse_signed_pdf_url;
        delete rest.signed_grn_pdf;
        delete rest.warehouse_signature;
        delete rest.warehouse_signature_time;
        delete rest.warehouse_signature_verified;
        delete rest.warehouse_signature_image;
        delete rest.warehouse_signature_name;
        delete rest.warehouse_signature_role;
        delete rest.warehouse_signature_employee_id;
        delete rest.warehouse_signature_email;
        delete rest.warehouse_signature_timestamp;
        delete rest.warehouse_signature_ip;
        delete rest.warehouse_signature_device;
        delete rest.warehouse_signature_algorithm;
        delete rest.warehouse_signature_version;
        delete rest.warehouse_signed_pdf_hash;
        draft = await createPurchaseReceipt(rest);
      }

      // eslint-disable-next-line no-console
      console.log("[GRN Submit] ERPNext stamped posting_date =", draft.posting_date);

      // Confirm the Purchase Receipt exists before attaching files.
      const createdName = draft.name;
      if (!createdName) {
        throw new Error("Purchase Receipt was created but no document name was returned.");
      }
      try {
        await getPurchaseReceipt(createdName);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[GRN Submit] Purchase Receipt missing before upload:", {
          name: createdName,
          err,
        });
        throw err;
      }

      // Attachments are best-effort: PR already exists — never fail GRN create
      // solely because upload_file returns 417 / network errors.
      for (const entry of attachments) {
        try {
          await uploadFileToERPNext(entry.file, "Purchase Receipt", createdName);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[GRN Submit] Attachment upload failed (non-fatal):", {
            doctype: "Purchase Receipt",
            docname: createdName,
            filename: entry.file.name,
            err,
          });
          toast(
            `Goods Receipt ${createdName} was created, but attachment "${entry.file.name}" could not be uploaded. You can attach it from the document detail page.`,
            { duration: 8_000, icon: "⚠️" },
          );
        }
      }

      // Sequence (draft only): capture → hash → save signature+envelope → save doc
      // → submit → generate PDF (PDF URL fields only; never envelope after submit).
      const signedSource: PurchaseReceipt = {
        ...draft,
        ...buildWarehouseEsignErpFields({
          ...signedEsign,
          verificationStatus: "verified",
        }),
        items: draft.items ?? [],
      } as PurchaseReceipt;
      let signedPdfUrl = "";
      let pdfHash = "";
      let signatureImageUrl = "";
      let signatureHash = signedEsign.signatureHash || "";
      try {
        const stored = await persistWarehouseGrnDigitalSignature(
          signedSource,
          { ...signedEsign, verificationStatus: "verified" },
          "Submitted",
        );
        if (!stored.signatureStored) {
          throw new Error("Warehouse Digital Signature metadata could not be stored.");
        }
        signedPdfUrl = stored.fileUrl;
        pdfHash = stored.pdfHash;
        signatureImageUrl = stored.signatureImageUrl;
        signatureHash = stored.signatureHash;
        setEsign((prev) => ({
          ...prev,
          ...signedEsign,
          signedPdfUrl: stored.fileUrl || prev.signedPdfUrl,
          signatureHash: stored.signatureHash,
          verificationStatus: "verified",
          locked: true,
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[GRN Submit] Digital Signature storage failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /UpdateAfterSubmitError/i.test(msg) ||
          /Not allowed to change .+ after submission/i.test(msg)
        ) {
          // Signature was already saved; continue to submit / treat as finalized.
          // eslint-disable-next-line no-console
          console.warn(
            "[GRN Submit] Ignoring post-submit field error during signature persist:",
            msg,
          );
        } else {
          throw new Error(
            `Warehouse Digital Signature could not be stored: ${msg}`,
          );
        }
      }

      const submitted = await submitPurchaseReceipt(draft.name);

      // Post-submit: only allowlisted PDF/signature URL fields (no envelope).
      try {
        await restampSignedGrnPdfUrl(
          submitted.name || draft.name,
          signedPdfUrl || "",
          {
            pdfHash: pdfHash || undefined,
            signatureImageUrl: signatureImageUrl || undefined,
            signatureHash,
            signedBy:
              signedEsign.fullName ||
              authUser?.full_name ||
              "Warehouse Manager",
            signedAt: signedEsign.signedAtIso || undefined,
          },
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[GRN Submit] Post-submit PDF field stamp skipped:", err);
      }

      try {
        await reconcileProcurementReadyToIssue();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[GRN submit] Ready-to-Issue reconciliation skipped:", err);
      }
      return submitted;
    },
    onSuccess: async (grn) => {
      setSubmittedGrnName(grn.name);
      setEsign((prev) => ({ ...prev, locked: true, verificationStatus: "verified" }));
      appendWarehouseEsignAudit(
        "GRN Submitted",
        esign.fullName || authUser?.full_name || "Warehouse Manager",
        grn.name,
        { grnName: grn.name, targetRole: "warehouse" },
      );
      toast.success("GRN successfully signed and finalized.");
      invalidateWarehouseStock(queryClient);
      void queryClient.invalidateQueries({
        queryKey: ["purchase-receipt", grn.name],
      });

      if (poName) {
        try {
          const [freshPo, freshGrns, freshInvoices] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: ["purchase-order", poName],
              queryFn: () => getPurchaseOrder(poName),
            }),
            queryClient.fetchQuery({
              queryKey: ["po-grns", poName],
              queryFn: () => getGRNsForPO(poName),
            }),
            queryClient.fetchQuery({
              queryKey: ["po-invoices", poName],
              queryFn: () => getInvoicesForPO(poName),
            }),
          ]);
          const submittedGrnCount = freshGrns.filter((g) => g.docstatus === 1).length;
          const primaryInvoice =
            freshInvoices.find((inv) => inv.docstatus === 1) ?? freshInvoices[0];
          await advancePoWorkflowAfterGrnSubmit(poName, {
            perReceived: freshPo.per_received ?? 0,
            perBilled: freshPo.per_billed ?? 0,
            submittedGrnCount,
            hasSubmittedInvoice: freshInvoices.some((inv) => inv.docstatus === 1),
            invoiceOutstanding: primaryInvoice?.outstanding_amount,
            invoiceGrandTotal: primaryInvoice?.grand_total,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[GRN Submit] PO workflow sync after GRN failed:", err);
          void queryClient.invalidateQueries({ queryKey: ["purchase-order", poName] });
          void queryClient.invalidateQueries({ queryKey: ["po-grns", poName] });
          void queryClient.invalidateQueries({ queryKey: ["po-shipment", poName] });
        }
      } else {
        void queryClient.invalidateQueries({ queryKey: ["incoming-purchase-orders"] });
      }
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[GRN Submit] error:", err);
      if (isDateConflictError(err)) {
        logGrnPostingDateDebug({
          browserDate: todayERPNextDate(),
          selectedDate: postingDate,
          payloadDate: postingDate,
          serverDate: erpToday,
          erpToday,
          poDate: poPostingDate || null,
          comparisonResult: "ERPNext REJECTED — check Payload vs ERP Today",
        });
      }
      const message = friendlyGrnError(err);
      setFieldErrors((prev) => ({ ...prev, submit: message }));
      // Avoid duplicate toast: interceptor may already have shown the friendly message.
      if (message !== "The GRN has already been finalized.") {
        toast.error(message);
      }
    },
  });

  function handleSubmit() {
    if (!validateStep(STEPS.length - 1)) return;
    const resolution = normalizeGrnPostingDate({
      selected: postingDate,
      poDate: poPostingDate || null,
      erpToday,
      browserToday: todayERPNextDate(),
    });

    if (resolution.invalidWindow) {
      const message = formatGrnPostingDateMessage("invalid_window", {
        poDate: resolution.floor,
        selectedDate: postingDate,
        today: resolution.ceiling,
      });
      setFieldErrors((prev) => ({ ...prev, submit: message }));
      toast.error(message);
      return;
    }

    if (postingDate !== resolution.postingDate) {
      setPostingDate(resolution.postingDate);
      if (resolution.clampedToPoDate) {
        toast(
          formatGrnPostingDateMessage("adjusted_to_po", {
            poDate: resolution.floor,
            selectedDate: postingDate,
          }),
          { icon: "ℹ️" },
        );
      } else if (resolution.clampedToErpToday) {
        toast(
          formatGrnPostingDateMessage("future_blocked", {
            poDate: resolution.floor,
            selectedDate: postingDate,
            today: resolution.ceiling,
            adjustedDate: resolution.postingDate,
          }),
          { icon: "ℹ️" },
        );
      }
    }

    setFieldErrors((prev) => ({ ...prev, submit: undefined }));
    submitMutation.mutate();
  }

  function startReceiving(targetPoName: string) {
    setPoName(targetPoName);
    setStep(0);
    setWarehouse("");
    // Reset so the PO-date effect can set default = PO posting date (not today).
    setPostingDateTouched(false);
    setPostingDate(todayERPNextDate());
    setRows([]);
    setNotes("");
    setAttachments([]);
    setFieldErrors({});
    setSubmittedGrnName(null);
    setEsign(
      createInitialWarehouseEsignState({
        fullName: authUser?.full_name || authUser?.email || "",
        designation: "Warehouse Manager",
        role: "Warehouse Manager",
        email: authUser?.email || "",
      }),
    );
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
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            GRN successfully signed and finalized.
          </div>
          <h1 className="text-2xl font-bold text-slate-900">GRN Created Successfully</h1>
          <p className="mt-2 text-sm text-slate-500">
            Goods receipt <span className="font-semibold text-slate-800">{submittedGrnName}</span>{" "}
            was submitted. Digital Signature is locked. Accepted quantities have been posted to
            inventory and the linked PO receipt status has been updated.
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
      <div className="flex w-full flex-col gap-6">
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            description="The purchase order or warehouses could not be loaded."
            onRetry={() => {
              void poQuery.refetch();
              void warehousesQuery.refetch();
            }}
          />
        )}

        {step === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            {poQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading purchase order…
              </div>
            ) : selectedPO ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">{selectedPO.name}</p>
                    <p className="mt-1 text-slate-600">
                      Supplier: {selectedPO.supplier_name ?? selectedPO.supplier}
                    </p>
                    <p className="text-slate-600">
                      Expected items: {(selectedPO.items ?? []).length}
                      {(selectedPO.per_received ?? 0) > 0
                        ? ` · Received ${Math.round(selectedPO.per_received ?? 0)}%`
                        : ""}
                      {selectedPO.status ? ` · Status: ${selectedPO.status}` : ""}
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
                {isFullyReceivedFromErp && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <p className="font-semibold">
                      This Purchase Order is already fully received.
                    </p>
                    <p className="mt-1 text-emerald-800/90">
                      Pending quantity is calculated from live PO lines
                      (ordered − received). Creating another GRN is blocked to
                      avoid double-receiving.
                    </p>
                    {primaryExistingGrn ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/p2p/grn/${encodeURIComponent(primaryExistingGrn.name)}`,
                            )
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          View GRN {primaryExistingGrn.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => exitWizard("upcoming")}
                          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                        >
                          Back to Upcoming Deliveries
                        </button>
                      </div>
                    ) : existingGrnsQuery.isLoading ? (
                      <p className="mt-2 text-xs text-emerald-700">
                        Looking up existing goods receipts…
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-amber-800">
                        PO received quantities are already 100%, but
                        no Purchase Receipt was found for this PO. Contact an
                        administrator before changing quantities.
                      </p>
                    )}
                  </div>
                )}
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
                    const raw = e.target.value;
                    setPostingDateTouched(true);
                    const resolution = normalizeGrnPostingDate({
                      selected: raw,
                      poDate: poPostingDate || null,
                      erpToday,
                      browserToday: localToday,
                    });
                    setPostingDate(resolution.postingDate);
                    if (resolution.clampedToPoDate) {
                      toast(
                        formatGrnPostingDateMessage("adjusted_to_po", {
                          poDate: resolution.floor,
                          selectedDate: raw,
                        }),
                        { icon: "ℹ️" },
                      );
                    } else if (resolution.clampedToErpToday) {
                      toast(
                        formatGrnPostingDateMessage("future_blocked", {
                          poDate: resolution.floor,
                          selectedDate: raw,
                          today: resolution.ceiling,
                          adjustedDate: resolution.postingDate,
                        }),
                        { icon: "ℹ️" },
                      );
                    }
                    setFieldErrors((prev) => ({ ...prev, submit: undefined }));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {poPostingDate
                    ? `Defaults to Purchase Order Date (${formatDate(poPostingDate)}). Allowed: PO date through today${
                        erpToday || localToday
                          ? ` (${formatDate(erpToday || localToday)})`
                          : ""
                      }.`
                    : `Calendar date only (YYYY-MM-DD). Today and past dates allowed; future dates blocked.`}
                </p>
                {postingResolution.invalidWindow ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {formatGrnPostingDateMessage("invalid_window", {
                      poDate: poPostingDate,
                      selectedDate: postingDate,
                      today: postingResolution.ceiling,
                    })}{" "}
                    If the browser date is correct, ERP System Settings time
                    zone may still be UTC — run{" "}
                    <code className="rounded bg-amber-100 px-1">
                      node scripts/setup-erp-timezone.mjs
                    </code>{" "}
                    and clear the ERP cache.
                  </p>
                ) : null}
                {serverDateQuery.data?.systemSettingsTimeZone &&
                /^(UTC|Etc\/UTC)$/i.test(
                  serverDateQuery.data.systemSettingsTimeZone,
                ) ? (
                  <p className="mt-1 text-xs text-amber-700">
                    ERP System Settings time zone is{" "}
                    {serverDateQuery.data.systemSettingsTimeZone} (UTC day{" "}
                    {serverDateQuery.data.utcToday ?? "—"}). Business calendar
                    uses {serverDateQuery.data.timeZone} (
                    {serverDateQuery.data.today}). Align ERP with{" "}
                    <code className="rounded bg-amber-100 px-1">
                      node scripts/setup-erp-timezone.mjs
                    </code>
                    .
                  </p>
                ) : null}
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
                        <th className="py-3 px-2 text-right">Already recv.</th>
                        <th className="py-3 px-2 text-right">Pending</th>
                        <th className="py-3 px-2 text-right">Receive now</th>
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
                            <td className="py-3 px-2 text-right tabular-nums text-slate-500">
                              {row.already_received_qty}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums font-medium">
                              {row.pending_qty}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={row.pending_qty}
                                step="any"
                                disabled={row.pending_qty <= 0 || isFullyReceivedFromErp}
                                title={
                                  row.pending_qty <= 0
                                    ? "No pending quantity left on this PO line"
                                    : undefined
                                }
                                value={row.received_qty || ""}
                                onChange={(e) =>
                                  updateRow(row.itemId, {
                                    received_qty: Math.min(
                                      parseFloat(e.target.value) || 0,
                                      row.pending_qty,
                                    ),
                                  })
                                }
                                className="w-20 rounded border border-slate-200 px-2 py-1 text-right disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
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
          <div className="space-y-4">
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
                  {attachments.length} attachment{attachments.length === 1 ? "" : "s"} will be
                  uploaded after the GRN is created.
                </p>
              )}
            </section>

            <WarehouseReviewSignPanel
              value={esign}
              onChange={setEsign}
              disabled={submitMutation.isPending || esign.locked}
            />

            {esign.locked && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                GRN successfully signed and finalized.
              </div>
            )}

            {fieldErrors.submit && (
              <p className="text-sm text-rose-600">{fieldErrors.submit}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0 || submitMutation.isPending || esign.locked}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={isFullyReceivedFromErp}
              title={
                isFullyReceivedFromErp
                  ? "This Purchase Order is already fully received — open the existing GRN instead."
                  : undefined
              }
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                submitMutation.isPending ||
                esign.locked ||
                isFullyReceivedFromErp ||
                !hasReviewSignatureReady(esign)
              }
              title={
                esign.locked
                  ? "GRN already signed and finalized."
                  : !hasReviewSignatureReady(esign)
                    ? "Capture your signature and certify received goods before Sign & Finalize."
                    : undefined
              }
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing & Finalizing…
                </>
              ) : esign.locked ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Finalized
                </>
              ) : (
                <>
                  <PackagePlus className="h-4 w-4" />
                  Sign & Finalize GRN
                </>
              )}
            </button>
          )}
        </div>

        {submitMutation.isPending && (
          <p className="text-center text-xs text-slate-500">
            Generating Signed GRN PDF, storing permanently, verifying SHA-256, then updating
            inventory…
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Truck}
          label="In Transit"
          value={receivingKpis.inTransit}
          loading={incomingQuery.isLoading}
          tone="primary"
        />
        <StatCard
          icon={Clock}
          label="Arriving Today"
          value={receivingKpis.arrivingToday}
          loading={incomingQuery.isLoading}
          tone="warning"
        />
        <StatCard
          icon={PackageCheck}
          label="Delivered Today"
          value={receivingKpis.deliveredToday}
          loading={grnHistoryQuery.isLoading}
          tone="accent"
        />
        <StatCard
          icon={AlertTriangle}
          label="Delayed Shipments"
          value={receivingKpis.delayedShipments}
          loading={incomingQuery.isLoading}
          tone="danger"
        />
      </div>

      <Tabs tabs={tabDefs} active={tab} onChange={setTab} />

      {tab === "upcoming" ? (
        <section className="space-y-3">
          <FilterBar>
            <FilterField label="Search" className="min-w-[200px] flex-1">
              <SearchInput
                value={upcomingSearch}
                onChange={setUpcomingSearch}
                placeholder="PO, supplier, vehicle, tracking…"
              />
            </FilterField>
            <FilterField label="Supplier" className="min-w-[160px]">
              <select
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
                className="select-field"
              >
                <option value="">All suppliers</option>
                {upcomingSupplierOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Shipment Status" className="min-w-[160px]">
              <select
                value={filterShipmentStatus}
                onChange={(e) => setFilterShipmentStatus(e.target.value)}
                className="select-field"
              >
                <option value="">All statuses</option>
                {shipmentStatusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {!shipmentStatusOptions.includes("Pending Acceptance") && (
                  <option value="Pending Acceptance">Pending Acceptance</option>
                )}
              </select>
            </FilterField>
            <FilterField label="ETA" className="min-w-[140px]">
              <input
                type="date"
                value={filterEta}
                onChange={(e) => setFilterEta(e.target.value)}
                className="input-field"
              />
            </FilterField>
            <FilterField label="Vehicle Number" className="min-w-[140px]">
              <input
                type="text"
                value={filterVehicle}
                onChange={(e) => setFilterVehicle(e.target.value)}
                placeholder="Vehicle…"
                className="input-field"
              />
            </FilterField>
            <FilterField label="Tracking Number" className="min-w-[140px]">
              <input
                type="text"
                value={filterTracking}
                onChange={(e) => setFilterTracking(e.target.value)}
                placeholder="Tracking…"
                className="input-field"
              />
            </FilterField>
            <FilterField label="Warehouse" className="min-w-[150px]">
              <select
                value={filterWarehouse}
                onChange={(e) => setFilterWarehouse(e.target.value)}
                className="select-field"
              >
                <option value="">All warehouses</option>
                {upcomingWarehouseOptions.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Overdue" className="min-w-[120px]">
              <label className="flex h-10 items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={filterOverdueOnly}
                  onChange={(e) => setFilterOverdueOnly(e.target.checked)}
                  className="rounded border-neutral-300"
                />
                Overdue only
              </label>
            </FilterField>
          </FilterBar>

          <div className="table-shell min-w-0">
            {incomingQuery.isLoading ? (
              <TableSkeleton rows={6} columns={9} />
            ) : incomingQuery.isError ? (
              <ErrorState
                title="Could not load purchase orders"
                description="Purchase orders awaiting receipt could not be loaded."
                onRetry={() => void incomingQuery.refetch()}
              />
            ) : filteredDeliveries.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No upcoming deliveries"
                description="No open purchase orders match the current filters."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[1100px]">
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Supplier</th>
                      <th>Shipment Status</th>
                      <th>Vehicle Number</th>
                      <th>Tracking Number</th>
                      <th>Expected Delivery (ETA)</th>
                      <th>Due Status</th>
                      <th className="text-right">Total Amount</th>
                      {canAct && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeliveries.map((d) => {
                      const meta = DELIVERY_URGENCY_META[d.urgency];
                      const action = resolveReceiveAction(d);
                      return (
                        <tr key={d.name}>
                          <td>
                            <div className="space-y-1">
                              <span className="table-link">{d.name}</span>
                              {(d.vehicle_number ||
                                d.tracking_number ||
                                d.dispatch_date) && (
                                <p className="text-[11px] text-neutral-500">
                                  {[
                                    d.dispatch_date
                                      ? `Dispatched ${formatDateTime(d.dispatch_date)}`
                                      : null,
                                    d.vehicle_number
                                      ? `Vehicle ${d.vehicle_number}`
                                      : null,
                                    d.tracking_number
                                      ? `Track ${d.tracking_number}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="text-neutral-600">
                            {d.supplier_name ?? d.supplier ?? "—"}
                          </td>
                          <td>
                            <StatusBadge
                              status={d.shipment_status || "Open"}
                            />
                          </td>
                          <td className="text-neutral-600">
                            {d.vehicle_number || "—"}
                          </td>
                          <td className="text-neutral-600">
                            {d.tracking_number || "—"}
                          </td>
                          <td className="text-neutral-600">
                            {d.displayExpectedDate
                              ? formatDate(d.displayExpectedDate)
                              : "—"}
                            {d.expected_delivery_date &&
                              d.schedule_date &&
                              d.expected_delivery_date !== d.schedule_date && (
                                <p className="text-[10px] text-neutral-400">
                                  PO required {formatDate(d.schedule_date)}
                                </p>
                              )}
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
                              {action.kind === "view_grn" && d.grn_name ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigate(
                                      `/p2p/grn/${encodeURIComponent(d.grn_name!)}`,
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View GRN
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={action.disabled}
                                  onClick={() => {
                                    if (!action.disabled) startReceiving(d.name);
                                  }}
                                  title={
                                    action.disabled
                                      ? action.label === "Waiting for Dispatch"
                                        ? "Supplier accepted — waiting for dispatch (In Transit)."
                                        : "Supplier has not accepted this PO yet."
                                      : undefined
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                                >
                                  <PackagePlus className="h-3.5 w-3.5" />
                                  {action.label}
                                </button>
                              )}
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
                description="Completed goods receipt notes could not be loaded."
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
