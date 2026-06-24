import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowLeft, Loader2, PackagePlus, RefreshCw } from "lucide-react";

import { apiGet, COMPANY, erpnext, withSilent } from "../../api/erpnext";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import {
  createPurchaseReceipt,
  getGRNsForPO,
  getPurchaseOrder,
  getPurchaseOrders,
} from "../../api/purchasing";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import { ErpNextDatePicker, type ErpNextDatePickerHandle } from "../../components/ui";
import type { PurchaseReceipt } from "../../types/erpnext";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import {
  compareERPNextDates,
  ERP_NEXT_ISO_DATE_RE,
  formatERPNextDate,
  formatUsDisplayDate,
  resolveGrnPostingDate,
} from "../../utils/erpNextDate";

dayjs.extend(customParseFormat);
import { canCreateGRNForPO } from "../../api/poDeliveryWorkflow";
import { formatCurrency, todayIso } from "../../utils/format";

async function fetchServerToday(): Promise<string> {
  try {
    const res = await erpnext.get("/api/method/frappe.utils.data.today", {
      _silent: true,
    } as Parameters<typeof erpnext.get>[1]);
    const msg = (res as unknown as { message?: string })?.message;
    if (typeof msg === "string" && /^\d{4}-\d{2}-\d{2}$/.test(msg)) return msg;
  } catch { /* fall through */ }
  return todayIso();
}

interface WarehouseRow {
  name: string;
  warehouse_name?: string;
}

interface ReceiveRow {
  itemId: string;
  item_code: string;
  item_name?: string;
  ordered_qty: number;
  pending_qty: number;
  received_qty: number;
  rate: number;
  uom?: string;
  warehouse?: string;
  po_item: string;
}

export default function NewGRNPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialPO = searchParams.get("po") ?? "";

  const role = useAuthStore((s) => s.user?.role);
  const blockedFromCreation = !canCreateGRN(role);

  const [poName, setPoName] = useState(initialPO);
  const [warehouse, setWarehouse] = useState("");
  const [postingDate, setPostingDate] = useState(todayIso());
  const [rows, setRows] = useState<ReceiveRow[]>([]);

  const postingDatePickerRef = useRef<ErpNextDatePickerHandle>(null);
  const postingDateEditedRef = useRef(false);

  const {
    data: openPOs = [],
    isError: poListError,
    refetch: refetchPOs,
  } = useQuery({
    queryKey: ["open-purchase-orders"],
    queryFn: () =>
      getPurchaseOrders({
        filters: [
          ["docstatus", "=", 1],
          ["status", "in", ["To Receive and Bill", "To Receive"]],
        ],
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "transaction_date",
          "schedule_date",
          "grand_total",
          "currency",
        ],
        limit_page_length: 200,
        order_by: "schedule_date asc",
      }),
    retry: 2,
  });

  const poOptionLabel = (p: (typeof openPOs)[number]): string => {
    const supplier = p.supplier_name ?? p.supplier ?? "—";
    const due = p.schedule_date
      ? formatUsDisplayDate(p.schedule_date)
      : "No date";
    const value = formatCurrency(p.grand_total ?? 0);
    return `${p.name} — ${supplier} • Due ${due} • ${value}`;
  };

  const {
    data: warehouses = [],
    isError: warehouseError,
    refetch: refetchWarehouses,
  } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiGet<WarehouseRow[]>("/api/resource/Warehouse", {
        ...withSilent(),
        params: {
          filters: JSON.stringify([
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ]),
          fields: JSON.stringify(["name", "warehouse_name"]),
          limit_page_length: 200,
          order_by: "warehouse_name asc",
        },
      }),
    retry: 2,
  });

  const { data: po, isFetching: poLoading, isError: poDetailError } = useQuery({
    queryKey: ["purchase-order", poName],
    queryFn: () => getPurchaseOrder(poName),
    enabled: !!poName,
    staleTime: 0,
    retry: 2,
  });

  const { data: existingGRNs = [] } = useQuery({
    queryKey: ["po-grns", poName],
    queryFn: () => getGRNsForPO(poName),
    enabled: !!poName,
    staleTime: 0,
    retry: 1,
  });
  const existingSubmittedGRN = existingGRNs.find((g) => g.docstatus === 1);

  const { data: serverToday } = useQuery({
    queryKey: ["erpnext-server-today"],
    queryFn: fetchServerToday,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const deliveryGate = useMemo(
    () => (poName ? canCreateGRNForPO(poName) : { allowed: true }),
    [poName]
  );

  const poTransactionDateIso = useMemo(
    () => formatERPNextDate(po?.transaction_date),
    [po?.transaction_date]
  );

  const poDateIsFuture = !!(
    poTransactionDateIso &&
    serverToday &&
    compareERPNextDates(poTransactionDateIso, serverToday) > 0
  );

  useEffect(() => {
    postingDateEditedRef.current = false;
    if (!poName) setPostingDate(serverToday ?? todayIso());
  }, [poName, serverToday]);

  useEffect(() => {
    if (!poName || !po?.transaction_date) return;
    const validDate = resolveGrnPostingDate(po.transaction_date, serverToday);
    if (postingDateEditedRef.current) {
      if (poTransactionDateIso && postingDate) {
        const postD = dayjs(postingDate, "YYYY-MM-DD", true);
        const poD = dayjs(poTransactionDateIso, "YYYY-MM-DD", true);
        if (postD.isValid() && poD.isValid() && postD.isBefore(poD)) {
          setPostingDate(validDate);
        }
      }
      if (serverToday && postingDate && compareERPNextDates(postingDate, serverToday) > 0) {
        setPostingDate(validDate);
      }
    } else {
      setPostingDate(validDate);
    }
  }, [poName, po?.transaction_date, poTransactionDateIso, postingDate, serverToday]);

  useEffect(() => {
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
          received_qty: pending,
          rate: it.rate ?? 0,
          uom: it.uom,
          warehouse: it.warehouse,
          po_item: it.name ?? "",
        };
      })
    );
  }, [po]);

  const total = useMemo(
    () => rows.reduce((sum, r) => sum + r.received_qty * r.rate, 0),
    [rows]
  );

  function updateRow(id: string, patch: Partial<ReceiveRow>) {
    setRows((prev) =>
      prev.map((r) => (r.itemId === id ? { ...r, ...patch } : r))
    );
  }

  function handlePostingDateChange(iso: string) {
    postingDateEditedRef.current = true;
    setPostingDate(iso);
  }

  function buildPayload(postingDateIso: string): Partial<PurchaseReceipt> {
    if (!po) throw new Error("Select a Purchase Order first.");

    const resolvedCompany = po.company || COMPANY;

    return {
      supplier: po.supplier,
      posting_date: postingDateIso,
      posting_time: new Date().toTimeString().slice(0, 8),
      set_posting_time: 1,
      company: resolvedCompany,
      currency: po.currency,
      items: rows
        .filter((r) => r.received_qty > 0)
        .map((r) => ({
          name: r.itemId,
          item_code: r.item_code,
          item_name: r.item_name,
          qty: r.received_qty,
          received_qty: r.received_qty,
          rate: r.rate,
          uom: r.uom,
          warehouse: r.warehouse || warehouse,
          purchase_order: po.name,
          purchase_order_item: r.po_item,
          amount: r.received_qty * r.rate,
        })),
    };
  }

  const dateValidation = useMemo(() => {
    if (!postingDate) return { valid: false, reason: "empty" as const };

    const postD = dayjs(postingDate, "YYYY-MM-DD", true).startOf("day");
    if (!postD.isValid()) return { valid: false, reason: "invalid" as const };

    if (poTransactionDateIso) {
      const poD = dayjs(poTransactionDateIso, "YYYY-MM-DD", true).startOf("day");
      if (poD.isValid() && postD.isBefore(poD))
        return { valid: false, reason: "before-po" as const };
    }

    if (serverToday && compareERPNextDates(postingDate, serverToday) > 0)
      return { valid: false, reason: "future" as const };

    return { valid: true, reason: "ok" as const };
  }, [poTransactionDateIso, postingDate, serverToday]);

  const isPostingDateInvalid = !dateValidation.valid;

  function validate(postingDateIso: string): string | null {
    if (!poName) return "Please select a Purchase Order.";
    if (!warehouse) return "Please choose a target warehouse.";
    if (!postingDateIso || !ERP_NEXT_ISO_DATE_RE.test(postingDateIso))
      return "Please enter a valid posting date.";
    if (dateValidation.reason === "before-po")
      return "Posting date must be on or after the Purchase Order date.";
    if (dateValidation.reason === "future")
      return "Posting date cannot be a future date.";
    if (!dateValidation.valid)
      return "Please enter a valid posting date.";
    const eligible = rows.filter((r) => r.received_qty > 0);
    if (eligible.length === 0)
      return "Enter received quantity for at least one item.";
    const overReceived = rows.find((r) => r.received_qty > r.pending_qty);
    if (overReceived)
      return `${overReceived.item_code}: received qty exceeds pending qty.`;
    return null;
  }

  const createMutation = useMutation({
    mutationFn: (payload: Partial<PurchaseReceipt>) =>
      createPurchaseReceipt(payload),
    onSuccess: (grn) => {
      toast.success(`GRN ${grn.name} created`, { id: "grn-success" });
      queryClient.invalidateQueries({ queryKey: ["purchase-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poName] });
      queryClient.invalidateQueries({ queryKey: ["open-purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["incoming-purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["po-grns", poName] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/p2p/grn");
    },
    onError: (err: unknown) => {
      const axErr = err as {
        response?: { status?: number; data?: { exc_type?: string; exc?: string; _server_messages?: string; message?: string } };
        message?: string;
      };

      // eslint-disable-next-line no-console
      console.group("GRN CREATE ERROR — FULL DETAILS");
      // eslint-disable-next-line no-console
      console.error("Error object:", err);
      // eslint-disable-next-line no-console
      console.error("Error message:", axErr.message);
      // eslint-disable-next-line no-console
      console.error("HTTP Status:", axErr.response?.status);
      // eslint-disable-next-line no-console
      console.error("ERPNext exc_type:", axErr.response?.data?.exc_type);
      // eslint-disable-next-line no-console
      console.error("ERPNext message:", axErr.response?.data?.message);
      // eslint-disable-next-line no-console
      console.error("ERPNext Response (full):", axErr.response?.data);
      if (axErr.response?.data?._server_messages) {
        try {
          const msgs = JSON.parse(axErr.response.data._server_messages);
          // eslint-disable-next-line no-console
          console.error("ERPNext Server Messages:", msgs);
        } catch { /* not JSON */ }
      }
      if (axErr.response?.data?.exc) {
        // eslint-disable-next-line no-console
        console.error("ERPNext Exception Traceback:", axErr.response.data.exc);
      }
      // eslint-disable-next-line no-console
      console.error("PO used:", poName);
      // eslint-disable-next-line no-console
      console.error("Warehouse:", warehouse);
      // eslint-disable-next-line no-console
      console.error("Posting Date:", postingDate);
      // eslint-disable-next-line no-console
      console.groupEnd();

      toast.dismiss("grn-err");
      toast.error("Unable to create GRN. Please contact administrator.", {
        id: "grn-err",
        duration: 6_000,
      });
    },
  });

  function handleCreate() {
    toast.dismiss("grn-err");

    const flushed = postingDatePickerRef.current?.flush();
    const rawIso = flushed ?? postingDate;
    const postingDateIso = formatERPNextDate(rawIso);

    if (!postingDateIso || !ERP_NEXT_ISO_DATE_RE.test(postingDateIso)) {
      toast.error("Please select a valid posting date.", { id: "grn-err" });
      return;
    }

    if (postingDateIso !== postingDate) setPostingDate(postingDateIso);

    const err = validate(postingDateIso);
    if (err) {
      toast.error(err, { id: "grn-err", duration: 6_000 });
      return;
    }

    const payload = buildPayload(postingDateIso);

    // eslint-disable-next-line no-console
    console.group("GRN PRE-SUBMIT VALIDATION");
    // eslint-disable-next-line no-console
    console.log("PO:", poName);
    // eslint-disable-next-line no-console
    console.log("PO exists:", !!po);
    // eslint-disable-next-line no-console
    console.log("Supplier:", payload.supplier, po?.supplier ? "✓" : "✗ MISSING");
    // eslint-disable-next-line no-console
    console.log("Company:", payload.company, payload.company ? "✓" : "✗ MISSING");
    // eslint-disable-next-line no-console
    console.log("PO.company:", po?.company, "| Fallback COMPANY:", COMPANY);
    // eslint-disable-next-line no-console
    console.log("Warehouse:", warehouse, warehouse ? "✓" : "✗ MISSING");
    // eslint-disable-next-line no-console
    console.log("Posting Date:", postingDateIso);
    // eslint-disable-next-line no-console
    console.log("Posting Time:", payload.posting_time);
    // eslint-disable-next-line no-console
    console.log("Currency:", payload.currency);
    const itemIssues = (payload.items ?? []).map((it, idx) => ({
      "#": idx + 1,
      item_code: it.item_code,
      qty: it.qty,
      received_qty: it.received_qty,
      rate: it.rate,
      warehouse: it.warehouse,
      purchase_order: it.purchase_order,
      purchase_order_item: it.purchase_order_item,
      has_item_code: !!it.item_code,
      qty_gt_0: (it.qty ?? 0) > 0,
      has_warehouse: !!it.warehouse,
      has_po_link: !!it.purchase_order,
    }));
    // eslint-disable-next-line no-console
    console.table(itemIssues);
    // eslint-disable-next-line no-console
    console.log("[GRN PAYLOAD]", JSON.parse(JSON.stringify(payload)));
    // eslint-disable-next-line no-console
    console.groupEnd();

    createMutation.mutate(payload);
  }

  if (blockedFromCreation) {
    return <Navigate to="/p2p/grn" replace />;
  }

  return (
    <div>
      <Link
        to="/p2p/grn"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to GRN
      </Link>

      <PageHeader
        title="New Goods Receipt Note"
        description="Receive goods against an open purchase order."
      />

      {(poListError || warehouseError || poDetailError) && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-500" />
          <div className="text-sm">
            <p className="font-semibold text-warning-900">
              Could not load some data
            </p>
            <p className="mt-0.5 text-warning-800">
              {poListError
                ? "Unable to load Purchase Orders."
                : warehouseError
                ? "Unable to load warehouses."
                : "Unable to load Purchase Order details."}
              {" "}Please check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => {
                if (poListError) refetchPOs();
                if (warehouseError) refetchWarehouses();
                if (poDetailError) queryClient.invalidateQueries({ queryKey: ["purchase-order", poName] });
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning-100 px-3 py-1.5 text-xs font-medium text-warning-800 hover:bg-warning-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}

      {!deliveryGate.allowed && poName && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger-200 bg-danger-50 p-4">
          <span className="text-lg leading-none">🚫</span>
          <div className="text-sm">
            <p className="font-semibold text-danger-900">
              GRN creation is not available for this PO
            </p>
            <p className="mt-0.5 text-danger-800">
              {deliveryGate.reason}
            </p>
          </div>
        </div>
      )}

      {existingSubmittedGRN && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4">
          <span className="text-lg leading-none">⚠️</span>
          <div className="text-sm">
            <p className="font-semibold text-warning-900">
              A completed GRN already exists for this Purchase Order
            </p>
            <p className="mt-0.5 text-warning-800">
              {existingSubmittedGRN.name} is already submitted. Creating
              another GRN may result in over-receiving.{" "}
              <Link
                to={`/p2p/grn/${encodeURIComponent(existingSubmittedGRN.name)}`}
                className="font-semibold underline"
              >
                View existing GRN →
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 card p-5 shadow-sm md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-700">
            Purchase Order<span className="text-danger-500">*</span>
          </label>
          <select
            value={poName}
            onChange={(e) => setPoName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <option value="">Select an open PO…</option>
            {openPOs.map((p) => (
              <option key={p.name} value={p.name}>
                {poOptionLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-700">
            Target Warehouse<span className="text-danger-500">*</span>
          </label>
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.name} value={w.name}>
                {w.warehouse_name ?? w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-700">
            Posting Date<span className="text-danger-500">*</span>
          </label>
          <ErpNextDatePicker
            ref={postingDatePickerRef}
            value={postingDate}
            onChange={handlePostingDateChange}
            min={poTransactionDateIso ?? undefined}
            max={serverToday ?? undefined}
          />
          {poTransactionDateIso && serverToday && (
            <p className="mt-1 text-xs text-neutral-400">
              {formatUsDisplayDate(poTransactionDateIso)} &ndash; {formatUsDisplayDate(serverToday)}
            </p>
          )}
        </div>
      </div>

      {poDateIsFuture && poName && (
        <div className="mt-3 mb-4 flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-500" />
          <div className="text-sm">
            <p className="font-semibold text-warning-900">
              Purchase Order date is ahead of today
            </p>
            <p className="mt-0.5 text-warning-800">
              This PO&rsquo;s date ({formatUsDisplayDate(poTransactionDateIso!)}) is after
              today ({formatUsDisplayDate(serverToday!)}). A GRN cannot be created until that
              date arrives, or the PO date is corrected in ERPNext.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Items to receive
          </h3>
          <p className="text-xs text-neutral-500">
            Default to pending quantity; adjust per line as needed.
          </p>
        </div>

        {!poName ? (
          <EmptyState
            icon={PackagePlus}
            title="Select a Purchase Order"
            description="Pick an open PO above to load its items."
          />
        ) : poLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="No pending items"
            description="This PO has no remaining quantity to receive."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Receive</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((r) => (
                  <tr key={r.itemId}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">
                        {r.item_code}
                      </div>
                      {r.item_name && r.item_name !== r.item_code && (
                        <div className="text-xs text-neutral-500">
                          {r.item_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                      {r.ordered_qty}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                      {r.pending_qty}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={r.pending_qty}
                        step="any"
                        value={r.received_qty}
                        onChange={(e) =>
                          updateRow(r.itemId, {
                            received_qty: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(r.rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(r.received_qty * r.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50">
                  <td
                    colSpan={5}
                    className="px-3 py-3 text-right text-sm font-medium"
                  >
                    Total to receive
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatCurrency(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate("/p2p/grn")}
          disabled={createMutation.isPending}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={
            createMutation.isPending ||
            !poName ||
            !!existingSubmittedGRN ||
            !deliveryGate.allowed ||
            isPostingDateInvalid ||
            poDateIsFuture
          }
          title={
            !deliveryGate.allowed
              ? deliveryGate.reason
              : existingSubmittedGRN
              ? `${existingSubmittedGRN.name} already covers this PO`
              : undefined
          }
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60"
        >
          {createMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Create GRN
        </button>
      </div>
    </div>
  );
}
