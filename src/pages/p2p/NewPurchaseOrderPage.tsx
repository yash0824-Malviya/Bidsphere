import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

import { ENV_DEFAULTS } from "../../api/erpnext";
import {
  createPurchaseOrder,
  submitPurchaseOrder,
} from "../../api/purchasing";
import { getRFQ, getSupplierQuotations } from "../../api/sourcing";
import { getSuppliers } from "../../api/supplier";
import {
  getApprovalState,
  isApprovedForPO,
  saveApprovalState,
} from "../../api/rfqApprovalWorkflow";
import ItemPicker from "../../components/ItemPicker";
import PageHeader from "../../components/PageHeader";
import { ErpNextDateDisplay, ErpNextDatePicker } from "../../components/ui";
import { Skeleton } from "../../components/Skeleton";
import type { PurchaseOrder, RFQApprovalState } from "../../types/erpnext";
import { formatCurrency, isoDateOffset, todayIso } from "../../utils/format";
import { assertERPNextDate } from "../../utils/erpNextDate";
import { generateId } from "../../utils/id";

interface DraftItem {
  id: string;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  rate: number;
  schedule_date: string;
}

function newDraftItem(): DraftItem {
  return {
    id: generateId(),
    item_code: "",
    item_name: "",
    qty: 1,
    uom: "",
    rate: 0,
    schedule_date: isoDateOffset(7),
  };
}

export default function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const rfqParam = searchParams.get("rfq") ?? "";

  const [supplier, setSupplier] = useState("");
  const [transactionDate] = useState(todayIso());
  const [scheduleDate, setScheduleDate] = useState(isoDateOffset(14));
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [prefillInfo, setPrefillInfo] = useState<{
    rfqRef: string;
    supplierName: string;
    approvedValue: number;
  } | null>(null);
  const [prefillLoaded, setPrefillLoaded] = useState(false);

  /* ── Approval state check ── */
  const approvalState = useMemo<RFQApprovalState | null>(() => {
    if (!rfqParam) return null;
    return getApprovalState(rfqParam);
  }, [rfqParam]);

  const approved = isApprovedForPO(approvalState);

  /* ── If ?rfq= is provided, fetch RFQ + quotation data for auto-fill ── */
  const rfqQuery = useQuery({
    queryKey: ["rfq-for-po", rfqParam],
    queryFn: () => getRFQ(rfqParam),
    enabled: !!rfqParam && approved,
    retry: false,
  });

  const sqQuery = useQuery({
    queryKey: ["sq-for-po", rfqParam],
    queryFn: () => getSupplierQuotations(rfqParam),
    enabled: !!rfqParam && approved && !!rfqQuery.data,
    retry: false,
  });

  useEffect(() => {
    if (prefillLoaded) return;
    if (!rfqParam || !approved || !approvalState) return;
    if (!rfqQuery.data) return;

    const rfq = rfqQuery.data;
    const quotations = sqQuery.data ?? [];
    const selectedSupplier = approvalState.selected_supplier;

    const winningQuote = quotations.find(
      (q) => q.supplier === selectedSupplier || q.supplier_name === selectedSupplier
    );

    // Use the ERPNext Supplier document ID from the quotation record, falling
    // back to the stored display name only when no quotation match is found.
    const resolvedSupplierId = winningQuote?.supplier ?? selectedSupplier;
    // eslint-disable-next-line no-console
    console.log("[NewPO] Selected supplier:", selectedSupplier);
    // eslint-disable-next-line no-console
    console.log("[NewPO] Resolved ERPNext supplier ID:", resolvedSupplierId);

    if (resolvedSupplierId) setSupplier(resolvedSupplierId);

    const quoteItems = winningQuote?.items ?? [];
    const rfqItems = rfq.items ?? [];

    if (quoteItems.length > 0) {
      setItems(
        quoteItems.map<DraftItem>((it) => ({
          id: generateId(),
          item_code: it.item_code ?? "",
          item_name: it.item_name ?? it.item_code ?? "",
          qty: it.qty ?? 1,
          uom: it.uom ?? "",
          rate: it.rate ?? 0,
          schedule_date: isoDateOffset(7),
        }))
      );
    } else if (rfqItems.length > 0) {
      setItems(
        rfqItems.map<DraftItem>((it) => ({
          id: generateId(),
          item_code: it.item_code ?? "",
          item_name: it.item_name ?? it.item_code ?? "",
          qty: it.qty ?? 1,
          uom: it.uom ?? "",
          rate: 0,
          schedule_date: isoDateOffset(7),
        }))
      );
    }

    setPrefillInfo({
      rfqRef: rfqParam,
      supplierName: winningQuote?.supplier_name ?? selectedSupplier ?? "",
      approvedValue: approvalState.selected_supplier_total ?? winningQuote?.grand_total ?? 0,
    });
    setPrefillLoaded(true);
    toast.success(`Auto-populated from approved RFQ ${rfqParam}`);
  }, [rfqParam, approved, approvalState, rfqQuery.data, sqQuery.data, prefillLoaded]);

  /* ── Legacy localStorage prefill (from RFQDetailPage) ── */
  useEffect(() => {
    if (rfqParam) return;
    const raw = localStorage.getItem("po_prefill");
    if (!raw) return;

    interface PoPrefill {
      supplier: string;
      supplier_name?: string;
      rfq_ref?: string;
      items: Array<{
        item_code: string;
        item_name?: string;
        qty: number;
        uom?: string;
        rate: number;
      }>;
    }

    let prefill: PoPrefill;
    try {
      prefill = JSON.parse(raw) as PoPrefill;
    } catch {
      localStorage.removeItem("po_prefill");
      return;
    }

    const rfqRef = prefill.rfq_ref ?? "";
    const state = rfqRef ? getApprovalState(rfqRef) : null;
    if (rfqRef && (!state || !isApprovedForPO(state))) {
      toast.error("PO creation requires Legal and Finance approval.");
      localStorage.removeItem("po_prefill");
      navigate("/dashboard");
      return;
    }

    if (prefill.supplier) {
      // eslint-disable-next-line no-console
      console.log("[NewPO] Legacy prefill supplier:", prefill.supplier);
      setSupplier(prefill.supplier);
    }
    if (Array.isArray(prefill.items) && prefill.items.length > 0) {
      setItems(
        prefill.items.map<DraftItem>((it) => ({
          id: generateId(),
          item_code: it.item_code,
          item_name: it.item_name ?? it.item_code,
          qty: it.qty ?? 1,
          uom: it.uom ?? "",
          rate: it.rate ?? 0,
          schedule_date: isoDateOffset(7),
        }))
      );
    }
    if (rfqRef) {
      setPrefillInfo({
        rfqRef,
        supplierName: prefill.supplier_name || prefill.supplier,
        approvedValue: 0,
      });
      toast.success(`Pre-filled from RFQ ${rfqRef}`);
    }
    localStorage.removeItem("po_prefill");
  }, [rfqParam, navigate]);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier-options"],
    queryFn: () =>
      getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "supplier_name"],
        limit_page_length: 200,
        order_by: "supplier_name asc",
      }),
  });

  const total = items.reduce((sum, it) => sum + it.qty * it.rate, 0);

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function buildPayload(): Partial<PurchaseOrder> {
    const payload: Partial<PurchaseOrder> = {
      supplier,
      transaction_date: transactionDate,
      schedule_date: scheduleDate,
      company: ENV_DEFAULTS.company,
      items: items
        .filter((i) => i.item_code && i.qty > 0)
        .map((i) => ({
          name: i.id,
          item_code: i.item_code,
          item_name: i.item_name,
          qty: i.qty,
          uom: i.uom,
          rate: i.rate,
          amount: i.qty * i.rate,
          schedule_date: i.schedule_date,
        })),
    };

    return {
      ...payload,
      transaction_date: assertERPNextDate(
        payload.transaction_date,
        "transaction_date"
      ),
      schedule_date: assertERPNextDate(payload.schedule_date, "schedule_date"),
      items: payload.items?.map((item) => ({
        ...item,
        schedule_date: item.schedule_date
          ? assertERPNextDate(item.schedule_date, "schedule_date")
          : item.schedule_date,
      })),
    };
  }

  function validate(): string | null {
    if (!supplier) return "Please select a supplier.";
    if (!scheduleDate) return "Required-by date is mandatory.";
    if (items.filter((i) => i.item_code && i.qty > 0).length === 0)
      return "Add at least one item.";
    return null;
  }

  const draftMutation = useMutation({
    mutationFn: (payload: Partial<PurchaseOrder>) =>
      createPurchaseOrder(payload),
    onSuccess: (po) => {
      markPOCreated();
      toast.success(`Draft saved as ${po.name}`);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate(`/p2p/purchase-orders/${po.name}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: Partial<PurchaseOrder>) => {
      const draft = await createPurchaseOrder(payload);
      return submitPurchaseOrder(draft.name);
    },
    onSuccess: (po) => {
      markPOCreated();
      toast.success(`${po.name} submitted`);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate(`/p2p/purchase-orders/${po.name}`);
    },
  });

  function markPOCreated() {
    const rfqRef = prefillInfo?.rfqRef ?? rfqParam;
    if (!rfqRef) return;
    const state = getApprovalState(rfqRef);
    if (state) {
      state.workflow_step = "PO Created";
      saveApprovalState(state);
    }
  }

  const isSaving = draftMutation.isPending || submitMutation.isPending;

  function handleSaveDraft() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    draftMutation.mutate(buildPayload() as Partial<PurchaseOrder>);
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    submitMutation.mutate(buildPayload() as Partial<PurchaseOrder>);
  }

  /* ── Guard: no approved RFQ ── */
  const hasRfqSource = !!rfqParam || !!prefillInfo;

  if (rfqParam && !approved && !rfqQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl py-20">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-100 mb-4">
            <AlertTriangle className="h-7 w-7 text-danger-600" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900">
            RFQ Not Approved for PO Creation
          </h2>
          <p className="mt-2 max-w-md text-sm text-neutral-600">
            Purchase Orders can only be created from RFQs that have been approved by both
            Legal and Finance reviewers. RFQ <span className="font-semibold">{rfqParam}</span> has
            not completed the approval workflow.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Go to Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate(`/sourcing/rfq/${encodeURIComponent(rfqParam)}`)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
            >
              View RFQ Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasRfqSource) {
    return (
      <div className="mx-auto max-w-2xl py-20">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-100 mb-4">
            <ShieldCheck className="h-7 w-7 text-warning-600" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900">
            Approval Required
          </h2>
          <p className="mt-2 max-w-md text-sm text-neutral-600">
            In the enterprise P2P workflow, Purchase Orders can only be created from RFQs that
            have completed the full approval process: AI Analysis, Legal Review, and Finance Review.
            Check your Dashboard for approved RFQs.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
            >
              Go to Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate("/p2p/purchase-orders")}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              View Existing POs
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (rfqQuery.isLoading || sqQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/p2p/purchase-orders"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to purchase orders
      </Link>

      <PageHeader
        title="New Purchase Order"
        description="Create a purchase order from an approved RFQ."
      />

      {prefillInfo && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-success-200 bg-success-50 px-4 py-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-success-600 shadow-sm ring-1 ring-success-200">
            <ClipboardCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 text-sm text-success-900">
            <p className="font-semibold">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              Approved RFQ: {prefillInfo.rfqRef}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-success-800/80">
              <Sparkles className="h-3 w-3" />
              Supplier: <span className="font-semibold">{prefillInfo.supplierName}</span>
              {prefillInfo.approvedValue > 0 && (
                <> &middot; Approved value: <span className="font-semibold">{formatCurrency(prefillInfo.approvedValue)}</span></>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="grid gap-4 card p-5 shadow-sm md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-700">
              Supplier<span className="text-danger-500">*</span>
            </label>
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              disabled={!!prefillInfo}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-100 disabled:text-neutral-500"
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.supplier_name ?? s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-700">
              Transaction Date
            </label>
            <ErpNextDateDisplay value={transactionDate} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-700">
              Required By
            </label>
            <ErpNextDatePicker
              value={scheduleDate}
              onChange={setScheduleDate}
              required
            />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, newDraftItem()])}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add Row
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 w-[28%]">Item Code</th>
                  <th className="px-3 py-2 w-[24%]">Item Name</th>
                  <th className="px-3 py-2 w-[10%] text-right">Qty</th>
                  <th className="px-3 py-2 w-[10%]">UOM</th>
                  <th className="px-3 py-2 w-[12%] text-right">Rate</th>
                  <th className="px-3 py-2 w-[12%] text-right">Amount</th>
                  <th className="px-3 py-2 w-[2%]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 align-top">
                      <ItemPicker
                        value={it.item_code}
                        onSelect={(opt) =>
                          updateItem(it.id, {
                            item_code: opt.name,
                            item_name: opt.item_name ?? opt.name,
                            uom: opt.stock_uom ?? "",
                            rate: opt.standard_rate ?? it.rate,
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        value={it.item_name}
                        onChange={(e) =>
                          updateItem(it.id, { item_name: e.target.value })
                        }
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={it.qty}
                        onChange={(e) =>
                          updateItem(it.id, {
                            qty: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        value={it.uom}
                        onChange={(e) =>
                          updateItem(it.id, { uom: e.target.value })
                        }
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={it.rate}
                        onChange={(e) =>
                          updateItem(it.id, {
                            rate: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-right text-sm font-medium tabular-nums">
                      {formatCurrency(it.qty * it.rate)}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.filter((p) => p.id !== it.id)
                          )
                        }
                        disabled={items.length === 1}
                        className="text-neutral-400 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50">
                  <td colSpan={5} className="px-3 py-3 text-right text-sm font-medium">
                    Total
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatCurrency(total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate("/p2p/purchase-orders")}
            disabled={isSaving}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg border border-primary bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary-50 disabled:opacity-60"
          >
            {draftMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save Draft
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60"
          >
            {submitMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Submit PO
          </button>
        </div>
      </div>
    </div>
  );
}
