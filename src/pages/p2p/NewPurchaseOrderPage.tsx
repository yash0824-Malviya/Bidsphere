import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { ENV_DEFAULTS } from "../../api/erpnext";
import {
  assertNoPOForRFQ,
  createPurchaseOrder,
  submitPurchaseOrder,
} from "../../api/purchasing";
import { getRFQ, getSupplierQuotations } from "../../api/sourcing";
import { getSuppliers } from "../../api/supplier";
import { getLegalDocsByRfq, type LegalDocumentSet } from "../../api/legalDocs";
import { clmError, clmViewerKey, getClmPurchaseOrderContext, saveClmPurchaseOrder } from "../../api/clm";
import PageHeader from "../../components/PageHeader";
import { ErpNextDateDisplay, ErpNextDatePicker } from "../../components/ui";
import { Skeleton } from "../../components/Skeleton";
import type { PurchaseOrder } from "../../types/erpnext";
import { formatCurrency, formatCurrencyIn, isoDateOffset, todayIso } from "../../utils/format";
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
  source?: PurchaseOrder["items"][number];
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

  const contractParam = searchParams.get("contract")?.trim() ?? "";
  const rfqParam = contractParam ? "" : searchParams.get("rfq") ?? "";

  const [supplier, setSupplier] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [scheduleDate, setScheduleDate] = useState(isoDateOffset(14));
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [prefillInfo, setPrefillInfo] = useState<{
    rfqRef: string;
    awardRef?: string;
    quotationRef?: string;
    supplierName: string;
    approvedValue: number;
  } | null>(null);
  const [prefillLoaded, setPrefillLoaded] = useState(false);
  const contractQuery = useQuery({
    queryKey: ["clm", "purchase-order", contractParam, clmViewerKey()],
    queryFn: () => getClmPurchaseOrderContext(contractParam),
    enabled: !!contractParam, staleTime: 0, retry: false,
    // Preserve the revision reviewed in the form; a changed Contract must conflict.
    refetchOnWindowFocus: false,
  });
  const contractContext = contractQuery.data;
  const deliveryContext = contractContext ? [
    ["Company", contractContext.payload.company],
    ...[["Delivery address", "shipping_address"], ["Supplier address", "supplier_address"], ["Payment terms", "payment_terms_template"], ["Incoterm", "incoterm"], ["Delivery place", "named_place"]].map(([label, key]) => [label, (contractContext.payload as Record<string, unknown>)[key]]),
  ].filter(([, value]) => typeof value === "string" && value.trim()) as string[][] : [];
  const currency = contractContext?.currency;
  const money = (amount: number) => contractParam ? formatCurrencyIn(amount, currency) : formatCurrency(amount);

  useEffect(() => {
    if (!contractParam || !contractContext || prefillLoaded) return;
    const payload = contractContext.payload;
    setSupplier(contractContext.supplier);
    if (payload.transaction_date) setTransactionDate(payload.transaction_date);
    if (payload.schedule_date) setScheduleDate(payload.schedule_date);
    setItems((payload.items || []).map(item => ({
      id: generateId(), item_code: item.item_code, item_name: item.item_name || item.item_code,
      qty: item.qty, uom: item.uom || "", rate: item.rate,
      schedule_date: item.schedule_date || payload.schedule_date || "", source: item,
    })));
    setPrefillInfo({ rfqRef: contractContext.rfq, awardRef: contractContext.award, quotationRef: contractContext.quotation, supplierName: payload.supplier_name || contractContext.supplier, approvedValue: contractContext.award_value });
    setPrefillLoaded(true);
  }, [contractParam, contractContext, prefillLoaded]);

  /* ── Approval state check — ERPNext's Legal Document Review is the single
   * source of truth for both Legal and Finance approval. ── */
  const legalDocQuery = useQuery<LegalDocumentSet | null>({
    queryKey: ["legal-document-review", "by-rfq", rfqParam],
    queryFn: () => getLegalDocsByRfq(rfqParam),
    enabled: !!rfqParam,
    staleTime: 0,
  });
  const approvalState = legalDocQuery.data ?? null;

  const approved =
    !!approvalState &&
    approvalState.review_status === "Approved" &&
    approvalState.finance_status === "Approved";

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
  const winningQuote = (sqQuery.data ?? []).find((quote) => approvalState?.sq_name
    ? quote.name === approvalState.sq_name
    : quote.supplier === approvalState?.supplier || quote.supplier_name === approvalState?.supplier);

  useEffect(() => {
    if (prefillLoaded) return;
    if (!rfqParam || !approved || !approvalState) return;
    // Wait for the saved winning quotation. Do not freeze RFQ target rows at a
    // zero rate while the quotation request is still loading.
    if (!rfqQuery.data || !winningQuote?.items?.length) return;
    const selectedSupplier = approvalState.supplier;

    // Retain the ERPNext Supplier document ID from the saved quotation.
    const resolvedSupplierId = winningQuote?.supplier ?? selectedSupplier;
    // eslint-disable-next-line no-console
    console.log("[NewPO] Selected supplier:", selectedSupplier);
    // eslint-disable-next-line no-console
    console.log("[NewPO] Resolved ERPNext supplier ID:", resolvedSupplierId);

    if (resolvedSupplierId) setSupplier(resolvedSupplierId);

    const quoteItems = winningQuote.items;

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
    }

    setPrefillInfo({
      rfqRef: rfqParam,
      awardRef: approvalState.name,
      quotationRef: winningQuote.name,
      supplierName: winningQuote?.supplier_name ?? selectedSupplier ?? "",
      approvedValue: approvalState.grand_total ?? winningQuote?.grand_total ?? 0,
    });
    setPrefillLoaded(true);
    toast.success(`Auto-populated from approved RFQ ${rfqParam}`);
  }, [rfqParam, approved, approvalState, rfqQuery.data, winningQuote, prefillLoaded]);

  /* ── Legacy localStorage prefill (from RFQDetailPage) ── */
  useEffect(() => {
    if (rfqParam || contractParam) return;
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

    (async () => {
      if (rfqRef) {
        const legalDoc = await getLegalDocsByRfq(rfqRef);
        const isReady =
          legalDoc?.review_status === "Approved" && legalDoc?.finance_status === "Approved";
        if (!isReady) {
          toast.error("PO creation requires Legal and Finance approval.");
          localStorage.removeItem("po_prefill");
          navigate("/dashboard");
          return;
        }
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
    })();
  }, [rfqParam, contractParam, navigate]);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier-options"],
    queryFn: () =>
      getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "supplier_name"],
        limit_page_length: 200,
        order_by: "supplier_name asc",
      }),
    enabled: !contractParam,
  });

  const total = items.reduce((sum, it) => sum + it.qty * it.rate, 0);

  function buildPayload(): Partial<PurchaseOrder> {
    // The read response also includes authoritative links and ERP metadata.
    // Send the reviewed source values and operational dates; the server owns linkage.
    const contractTerms = contractParam && contractContext ? Object.fromEntries(
      ["terms", "payment_terms_template", "supplier_address", "shipping_address", "billing_address", "incoterm", "named_place"]
        .filter(key => Object.hasOwn(contractContext.payload, key))
        .map(key => [key, (contractContext.payload as Record<string, unknown>)[key]])
    ) : {};
    const payload: Partial<PurchaseOrder> = {
      ...contractTerms,
      supplier,
      transaction_date: transactionDate,
      schedule_date: scheduleDate,
      company: contractParam ? contractContext?.payload.company : ENV_DEFAULTS.company,
      ...(contractParam ? { currency: contractContext?.currency } : {}),
      items: items
        .filter((i) => i.item_code && i.qty > 0)
        .map((i) => ({
          ...i.source,
          name: i.source?.name || i.id,
          item_code: i.item_code,
          item_name: i.item_name,
          qty: i.qty,
          uom: i.uom,
          rate: i.rate,
          amount: i.qty * i.rate,
          schedule_date: contractParam ? scheduleDate : i.schedule_date,
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
    mutationFn: async (payload: Partial<PurchaseOrder>) => {
      if (rfqParam) await assertNoPOForRFQ(rfqParam);
      return createPurchaseOrder(payload);
    },
    onSuccess: (po) => {
      toast.success(`Draft saved as ${po.name}`);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate(`/p2p/purchase-orders/${po.name}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: Partial<PurchaseOrder>) => {
      if (rfqParam) await assertNoPOForRFQ(rfqParam);
      const draft = await createPurchaseOrder(payload);
      return submitPurchaseOrder(draft.name);
    },
    onSuccess: (po) => {
      toast.success(`${po.name} submitted`);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["po-queue-ready-rfqs"] });
      navigate(`/p2p/purchase-orders/${po.name}`);
    },
  });

  const contractMutation = useMutation({
    mutationFn: (operation: "save_draft" | "submit") => saveClmPurchaseOrder({
      name: contractParam, expected_modified: contractContext?.expected_modified || "", operation, payload: buildPayload(),
    }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["po-queue-ready-rfqs"] });
      await queryClient.invalidateQueries({ queryKey: ["clm", "detail"] });
      await queryClient.invalidateQueries({ queryKey: ["clm", "list"] });
      if (contractContext?.rfq) await queryClient.invalidateQueries({ queryKey: ["rfq", contractContext.rfq] });
      if (result.completed) {
        toast.success(`PO Created Successfully: ${result.purchase_order.name}. Contract finalized.`);
        navigate(`/contracts/${encodeURIComponent(contractParam)}`);
      } else {
        toast.success(`Draft saved as ${result.purchase_order.name}. Submit the PO to complete the Contract.`);
        await contractQuery.refetch();
      }
    },
    onError: error => toast.error(clmError(error)),
  });

  const isSaving = draftMutation.isPending || submitMutation.isPending || contractMutation.isPending;

  function handleSaveDraft() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (contractParam) contractMutation.mutate("save_draft");
    else draftMutation.mutate(buildPayload() as Partial<PurchaseOrder>);
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (contractParam) contractMutation.mutate("submit");
    else submitMutation.mutate(buildPayload() as Partial<PurchaseOrder>);
  }

  /* ── Guard: no approved RFQ ── */
  const hasRfqSource = !!contractParam || !!rfqParam || !!prefillInfo;

  if (contractParam && contractQuery.isError) return <div role="alert" className="mx-auto max-w-2xl space-y-4 rounded-xl border border-danger-200 bg-danger-50 p-5 text-sm text-danger-800"><h1 className="text-lg font-semibold">Purchase Order unavailable</h1><p>{clmError(contractQuery.error)}</p><Link className="inline-block font-semibold underline" to={`/contracts/${encodeURIComponent(contractParam)}`}>Return to Contract</Link><button type="button" className="ml-4 font-semibold underline" onClick={() => void contractQuery.refetch()}>Retry</button></div>;

  if (contractParam && (contractQuery.isLoading || !contractContext || !prefillLoaded)) return <div className="space-y-4 p-6" role="status" aria-label="Loading Contract Purchase Order"><Skeleton className="h-8 w-64 rounded-lg" /><Skeleton className="h-[400px] rounded-xl" /></div>;

  if (contractContext?.completed && contractContext.purchase_order) return <section className="space-y-4 rounded-xl border border-success-200 bg-success-50 p-5"><h1 className="text-lg font-semibold">PO Created Successfully</h1><p>Purchase Order: <strong>{contractContext.purchase_order.name}</strong></p><p>This Contract is completed. Its saved Purchase Order is reused.</p><div className="flex flex-wrap gap-4"><Link className="font-semibold text-primary" to={`/p2p/purchase-orders/${encodeURIComponent(contractContext.purchase_order.name)}`}>View Purchase Order</Link><Link className="font-semibold text-primary" to={`/contracts/${encodeURIComponent(contractParam)}`}>Return to Contract</Link></div></section>;

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

  if (rfqParam && (rfqQuery.isError || sqQuery.isError || (sqQuery.data && !winningQuote?.items?.length))) {
    const sourceError = rfqQuery.error || sqQuery.error;
    return <section role="alert" className="mx-auto max-w-2xl space-y-4 rounded-xl border border-danger-200 bg-danger-50 p-5 text-sm text-danger-800"><h1 className="text-lg font-semibold">Awarded quotation unavailable</h1><p>{sourceError instanceof Error ? sourceError.message : "The approved winning quotation and its items could not be loaded. Reload the source before creating the Purchase Order."}</p><Link className="font-semibold underline" to={`/sourcing/rfq/${encodeURIComponent(rfqParam)}`}>View RFQ Details</Link><button type="button" className="ml-4 font-semibold underline" onClick={() => { void rfqQuery.refetch(); void sqQuery.refetch(); }}>Retry</button></section>;
  }

  if (rfqQuery.isLoading || sqQuery.isLoading || (rfqParam && !prefillLoaded)) {
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
        to={contractParam ? `/contracts/${encodeURIComponent(contractParam)}` : "/p2p/purchase-orders"}
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> {contractParam ? "Back to Contract" : "Back to purchase orders"}
      </Link>

      <PageHeader
        title="New Purchase Order"
        description={contractParam ? "Review the approved Contract and award details, then submit the PO to complete Procurement Finalization." : "Create a purchase order from an approved RFQ."}
      />

      {prefillInfo && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-success-200 bg-success-50 px-4 py-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-success-600 shadow-sm ring-1 ring-success-200">
            <ClipboardCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 text-sm text-success-900">
            <p className="font-semibold">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              Approved RFQ: {prefillInfo.rfqRef} <Lock className="ml-1 inline h-3 w-3" aria-hidden="true" />
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-success-800/80">
              <Sparkles className="h-3 w-3" />
              Supplier: <span className="font-semibold">{prefillInfo.supplierName}</span>
              {prefillInfo.approvedValue > 0 && (
                <> &middot; Approved value: <span className="font-semibold">{money(prefillInfo.approvedValue)}</span></>
              )}
            </p>
          </div>
        </div>
      )}

      {!contractContext && prefillInfo && <section aria-label="Award Purchase Order context" className="mb-4 min-w-0 rounded-xl border border-neutral-200 bg-white p-4 text-sm"><dl className="grid min-w-0 gap-3 sm:grid-cols-3">{[["RFQ", prefillInfo.rfqRef], ["Award", prefillInfo.awardRef], ["Winning Quotation", prefillInfo.quotationRef]].filter(([, value]) => value).map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-xs text-neutral-500">{label} <Lock className="ml-1 inline h-3 w-3" aria-hidden="true" /></dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl></section>}

      {contractContext && <section aria-label="Contract Purchase Order context" className="mb-4 min-w-0 rounded-xl border border-neutral-200 bg-white p-4 text-sm"><dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Contract", contractParam], ["RFQ", contractContext.rfq], ["Award", contractContext.award], ["Winning Quotation", contractContext.quotation], ["Currency", contractContext.currency], ...deliveryContext].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-xs text-neutral-500">{label}{["Contract", "RFQ", "Award", "Winning Quotation", "Currency"].includes(label) && <Lock className="ml-1 inline h-3 w-3" aria-hidden="true" />}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>{contractContext.purchase_order && <p className="mt-3 text-sm text-primary">Draft Purchase Order: {contractContext.purchase_order.name}. Saving or submitting reuses this PO.</p>}{contractContext.payload.terms && <div className="mt-3"><h2 className="text-xs font-semibold text-neutral-500">Payment / delivery terms</h2><p className="mt-1 whitespace-pre-wrap break-words">{contractContext.payload.terms.replace(/<[^>]*>/g, " ")}</p></div>}<p className="mt-3 text-xs text-neutral-500">The Contract remains at Procurement Finalization until the Purchase Order is successfully submitted.</p></section>}
      {contractMutation.isError && <p role="alert" className="mb-4 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">{clmError(contractMutation.error)}</p>}

      <div className="space-y-6">
        <div className="grid gap-4 card p-5 shadow-sm md:grid-cols-3">
          <div>
            <label htmlFor="po-awarded-supplier" className="mb-1.5 block text-xs font-medium text-neutral-700">
              Supplier <Lock className="ml-1 inline h-3 w-3 text-neutral-400" aria-hidden="true" />
            </label>
            <select
              id="po-awarded-supplier"
              aria-label="Supplier"
              value={supplier}
              disabled
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-100 disabled:text-neutral-500"
            >
              <option value="">Select supplier…</option>
              {supplier && <option value={supplier}>{prefillInfo?.supplierName || supplier}</option>}
              {suppliers.filter((s) => s.name !== supplier).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.supplier_name ?? s.name}
                </option>
              ))}
            </select>
            {prefillInfo?.awardRef && <p className="mt-1.5 text-xs text-neutral-500">From Award {prefillInfo.awardRef}</p>}
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
            <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Awarded quotation · Read-only</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 w-[26%]">Item Code <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                  <th className="px-3 py-2 w-[26%]">Item Name <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                  <th className="px-3 py-2 w-[10%] text-right">Qty <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                  <th className="px-3 py-2 w-[10%]">UOM <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                  <th className="px-3 py-2 w-[14%] text-right">Award Rate <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                  <th className="px-3 py-2 w-[14%] text-right">Amount <Lock className="inline h-3 w-3" aria-hidden="true" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 align-top">
                      <input
                        aria-label={`Item code for ${it.item_code}`}
                        value={it.item_code}
                        title={it.item_code}
                        readOnly
                        aria-readonly={true}
                        className="w-full cursor-default rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        aria-label={`Item name for ${it.item_code || "new item"}`}
                        value={it.item_name}
                        title={it.item_name}
                        readOnly
                        aria-readonly={true}
                        className="w-full cursor-default rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        aria-label={`Quantity for ${it.item_code || "new item"}`}
                        value={it.qty}
                        readOnly
                        aria-readonly={true}
                        className="w-full cursor-default rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-right text-sm tabular-nums text-neutral-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        aria-label={`UOM for ${it.item_code || "new item"}`}
                        value={it.uom}
                        readOnly
                        aria-readonly={true}
                        className="w-full cursor-default rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        aria-label={`Rate for ${it.item_code || "new item"}`}
                        value={it.rate}
                        readOnly
                        aria-readonly={true}
                        className="w-full cursor-default rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-right text-sm tabular-nums text-neutral-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-right text-sm font-medium tabular-nums">
                      <span className="block rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-neutral-600">{money(it.qty * it.rate)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50">
                  <td colSpan={5} className="px-3 py-3 text-right text-sm font-medium">
                    Total <Lock className="ml-1 inline h-3 w-3 text-neutral-400" aria-hidden="true" />
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate(contractParam ? `/contracts/${encodeURIComponent(contractParam)}` : "/p2p/purchase-orders")}
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
            {contractParam ? "Create & Submit Purchase Order" : "Submit PO"}
          </button>
        </div>
      </div>
    </div>
  );
}
