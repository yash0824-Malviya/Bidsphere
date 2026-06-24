import { useLayoutEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Layers,
  Loader2,
  PackagePlus,
  Receipt,
  Send,
  Truck,
} from "lucide-react";

import { APP_NAME } from "../../config/branding";
import { getInvoicesForPO } from "../../api/accounts";
import type { InvoiceRow } from "../../api/accounts";
import {
  getGRNsForPO,
  getPurchaseOrder,
  submitPurchaseOrder,
} from "../../api/purchasing";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { useAuthStore } from "../../store/authStore";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { canCreateGRN } from "../../config/roles";
import {
  type PODeliveryState,
  getDeliveryState,
  ensureDeliveryState,
} from "../../api/poDeliveryWorkflow";
import POStatusTimeline from "../../components/p2p/POStatusTimeline";
import { buildProcurementWorkflowSteps } from "../../utils/procurementStatusWorkflow";
import {
  formatCurrency,
  formatDate,
  formatDisplayDate,
  formatDisplayDateTime,
  formatPercent,
} from "../../utils/format";

type TabKey = "items" | "grn" | "invoices" | "audit";

const TABS: { key: TabKey; label: string; icon: typeof Layers }[] = [
  { key: "items", label: "Items", icon: Layers },
  { key: "grn", label: "GRN", icon: PackagePlus },
  { key: "invoices", label: "Invoices", icon: Receipt },
  { key: "audit", label: "Audit Trail", icon: Clock },
];

export default function PurchaseOrderDetailPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<TabKey>("items");

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: po, isLoading, isError } = useQuery({
    queryKey: ["purchase-order", name],
    queryFn: () => getPurchaseOrder(name),
    enabled: !!name,
    staleTime: 0,
  });

  const grnsQuery = useQuery({
    queryKey: ["po-grns", name],
    queryFn: () => getGRNsForPO(name),
    enabled: !!name,
    staleTime: 0,
  });

  const invoicesQuery = useQuery({
    queryKey: ["po-invoices", name],
    queryFn: () => getInvoicesForPO(name),
    enabled: !!name,
    staleTime: 0,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitPurchaseOrder(name),
    onSuccess: () => {
      toast.success(`${name} submitted`);
      queryClient.invalidateQueries({ queryKey: ["purchase-order", name] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["po-grns", name] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-14 rounded" />
        <div className="grid grid-cols-4 gap-1.5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
        <div className="grid grid-cols-[1fr_240px] gap-2">
          <Skeleton className="h-[420px] rounded" />
          <Skeleton className="h-[420px] rounded" />
        </div>
      </div>
    );
  }

  if (isError || !po) {
    return (
      <div>
        <Link to="/p2p/purchase-orders" className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-primary-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <EmptyState icon={FileCheck2} title="Purchase order not found" description="It may have been deleted, or you may not have access." />
      </div>
    );
  }

  const isDraft = (po.docstatus ?? 0) === 0;
  const isSubmitted = (po.docstatus ?? 0) === 1;

  const deliveryState: PODeliveryState | null = (() => {
    if (!po.name) return null;
    return isSubmitted ? ensureDeliveryState(po.name) : getDeliveryState(po.name);
  })();

  const grns = grnsQuery.data ?? [];
  const submittedGRNs = grns.filter((g) => g.docstatus === 1);
  const hasSubmittedGRN = submittedGRNs.length > 0;
  const receivedPct = po.per_received ?? 0;
  const isFullyReceived = receivedPct >= 100;
  const allInvoices = invoicesQuery.data ?? [];
  const activeInvoices = allInvoices.filter((inv) => inv.docstatus !== 2);
  const primaryInvoice =
    activeInvoices.find((inv) => inv.docstatus === 1) ?? activeInvoices[0];
  const hasInvoice = !!primaryInvoice;
  const billedPct = po.per_billed ?? 0;
  const allInvoicesPaid = hasInvoice && (primaryInvoice.outstanding_amount ?? 1) === 0;
  const itemCount = (po.items ?? []).length;
  const grandTotal = po.grand_total ?? 0;
  const netTotal = po.net_total ?? po.total ?? grandTotal;
  const taxTotal = po.total_taxes_and_charges ?? (grandTotal - netTotal);

  const workflowInvoice = primaryInvoice;

  const openInvoiceDetail = () => {
    if (!primaryInvoice?.name) return;
    navigate(
      `/p2p/invoices/${encodeURIComponent(primaryInvoice.name)}?fromPo=${encodeURIComponent(po.name)}`
    );
  };

  const hasSubmittedInvoice = activeInvoices.some((inv) => inv.docstatus === 1);

  const procurementSteps = buildProcurementWorkflowSteps({
    poSubmitted: isSubmitted,
    deliveryState,
    hasSubmittedGRN,
    hasSubmittedInvoice,
    invoiceOutstanding: workflowInvoice?.outstanding_amount,
    invoiceGrandTotal: workflowInvoice?.grand_total,
    paymentCompleted: allInvoicesPaid,
  });

  const auditEntries = [
    { label: "Purchase Order Created", ts: po.creation, done: true },
    { label: isSubmitted ? "PO Submitted" : "Awaiting Submission", ts: isSubmitted ? po.modified : null, done: isSubmitted },
    ...submittedGRNs.map((g) => ({ label: `Goods Received — ${g.name}`, ts: g.modified ?? g.posting_date ?? null, done: true as const })),
    ...activeInvoices.map((inv) => ({ label: `Invoice — ${inv.name} (${inv.status ?? "Draft"})`, ts: inv.modified ?? null, done: true as const })),
    ...(allInvoicesPaid ? [{ label: "Payment Complete", ts: primaryInvoice?.modified ?? null, done: true as const }] : []),
  ];

  return (
    <div>
      {/* ── Back link ── */}
      <button
        type="button"
        onClick={() => navigate("/p2p/purchase-orders")}
        className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-neutral-400 transition hover:text-primary cursor-pointer bg-transparent border-none p-0"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Purchase Orders
      </button>

      {/* ── Header bar ── */}
      <div className="mb-2 flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <FileText className="h-4 w-4 text-primary-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-neutral-900 tabular-nums">{po.name}</h1>
              <CompactStatus status={po.status ?? "Draft"} />
            </div>
            <p className="text-xs text-neutral-500 truncate">
              {po.supplier_name ?? po.supplier} &middot; {po.company ?? "—"} &middot; {po.currency ?? "USD"}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {isDraft && (
            <ActionBtn
              icon={Send}
              label="Submit PO"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              variant="primary"
            />
          )}
          {isSubmitted && canCreateGRN(role) && !isFullyReceived && (
            <ActionBtn
              icon={PackagePlus}
              label={hasSubmittedGRN ? "View GRN" : "Create GRN"}
              onClick={() => navigate(hasSubmittedGRN ? `/warehouse/grn/${encodeURIComponent(submittedGRNs[0]?.name ?? "")}` : `/warehouse/grn/create?po=${encodeURIComponent(po.name)}`)}
              variant={hasSubmittedGRN ? "ghost" : "success"}
            />
          )}
          {isSubmitted && hasSubmittedGRN && (
            <ActionBtn
              icon={Receipt}
              label={hasInvoice ? "View Invoice" : "Create Invoice"}
              onClick={() =>
                hasInvoice
                  ? openInvoiceDetail()
                  : navigate(
                      `/p2p/invoices/create?po=${encodeURIComponent(po.name)}`
                    )
              }
              variant={hasInvoice ? "ghost" : "success"}
            />
          )}
          <ActionBtn
            icon={Download}
            label="PDF"
            onClick={() => window.open(`/api/method/frappe.utils.print_format.download_pdf?doctype=Purchase Order&name=${encodeURIComponent(po.name)}&format=Standard`, "_blank")}
            variant="ghost"
          />
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="mb-2 grid grid-cols-4 gap-1.5">
        <Kpi icon={DollarSign} label="Total Value" value={formatCurrency(grandTotal)} tone="primary" />
        <Kpi icon={Layers} label="Line Items" value={String(itemCount)} tone="neutral" />
        <Kpi icon={Truck} label="Received" value={formatPercent(receivedPct)} tone={isFullyReceived ? "success" : "warning"} />
        <Kpi icon={Receipt} label="Billed" value={formatPercent(billedPct)} tone={billedPct >= 100 ? "success" : "warning"} />
      </div>

      {/* ── Main two-column layout ── */}
      <div className="grid gap-2 lg:grid-cols-[1fr_250px]">
        {/* ── Left column ── */}
        <div className="space-y-2">
          {/* PO Information card */}
          <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-3 py-1.5">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">PO Information</h2>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-3 py-2 text-xs lg:grid-cols-4">
              <InfoField label="PO Number" value={po.name} mono />
              <InfoField label="Status" badge={po.status ?? "Draft"} />
              <InfoField label="Supplier" value={po.supplier_name ?? po.supplier ?? "—"} />
              <InfoField label="Company" value={po.company ?? "—"} />
              <InfoField label="PO Date" value={formatDate(po.transaction_date)} />
              <InfoField label="Required By" value={po.schedule_date ? formatDate(po.schedule_date) : "—"} />
              <InfoField label="Currency" value={po.currency ?? "USD"} />
              <InfoField label="Owner" value={APP_NAME} />
            </div>
          </div>

          {/* PO Status timeline */}
          <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-3 py-1.5">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">PO Status</h2>
            </div>
            <POStatusTimeline steps={procurementSteps} />
          </div>

          {/* Tabs + content */}
          <div>
            <div className="flex border-b border-neutral-200">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-1 border-b-2 px-3 py-2 text-[11px] font-semibold transition cursor-pointer bg-transparent ${
                      active ? "border-primary text-primary-700" : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {tab.label}
                    {tab.key === "grn" && grns.length > 0 && <CountBadge n={grns.length} />}
                    {tab.key === "invoices" && activeInvoices.length > 0 && <CountBadge n={activeInvoices.length} />}
                  </button>
                );
              })}
            </div>
            <div className="rounded-b-lg border border-t-0 border-neutral-200 bg-white shadow-sm">
              {activeTab === "items" && <ItemsTab items={po.items ?? []} grandTotal={grandTotal} />}
              {activeTab === "grn" && <GRNTab grns={grns} poName={po.name} />}
              {activeTab === "invoices" && (
                <InvoicesTab invoices={activeInvoices} poName={po.name} />
              )}
              {activeTab === "audit" && <AuditTab entries={auditEntries} />}
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-2">
          {/* Quick Summary */}
          <SideCard title="Quick Summary">
            <SummaryRow label="Net Total" value={formatCurrency(netTotal)} />
            <SummaryRow label="Taxes" value={formatCurrency(taxTotal)} />
            <div className="my-1 border-t border-dashed border-neutral-200" />
            <SummaryRow label="Grand Total" value={formatCurrency(grandTotal)} bold />
            <div className="my-1 border-t border-dashed border-neutral-200" />
            <SummaryRow label="Received" value={formatPercent(receivedPct)} />
            <SummaryRow label="Billed" value={formatPercent(billedPct)} />
          </SideCard>

          {/* Actions */}
          <SideCard title="Actions">
            <div className="space-y-1.5">
              {hasInvoice && (
                <SideActionBtn
                  icon={Receipt}
                  label="View Invoice"
                  onClick={openInvoiceDetail}
                  tone="neutral"
                />
              )}
              <SideActionBtn
                icon={Download}
                label="Download PDF"
                onClick={() =>
                  window.open(
                    `/api/method/frappe.utils.print_format.download_pdf?doctype=Purchase Order&name=${encodeURIComponent(po.name)}&format=Standard`,
                    "_blank"
                  )
                }
                tone="neutral"
              />
            </div>
          </SideCard>

          {/* Supplier Delivery Information */}
          {deliveryState && (
            <SideCard title="Supplier Delivery">
              <div className="divide-y divide-neutral-100">
                <DeliveryDetailRow
                  label="Delivery Status"
                  value={
                    <DeliveryStatusBadge status={deliveryState.status} />
                  }
                />
                <DeliveryDetailRow
                  label="Acceptance Date"
                  value={formatDisplayDateTime(
                    deliveryState.supplier_acceptance_date
                  )}
                />
                <DeliveryDetailRow
                  label="Expected Delivery"
                  value={formatDisplayDate(
                    deliveryState.expected_delivery_date
                  )}
                />
                <DeliveryDetailRow
                  label="Vehicle Number"
                  value={deliveryState.vehicle_number || "—"}
                />
                <DeliveryDetailRow
                  label="Tracking Number"
                  value={deliveryState.tracking_number || "—"}
                />
              </div>
              {deliveryState.rejection_reason && (
                <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 px-2.5 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-danger-700">
                    Rejection Reason
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-danger-800">
                    {deliveryState.rejection_reason}
                  </p>
                </div>
              )}
            </SideCard>
          )}

          {/* Related Documents */}
          <SideCard title="Related Documents">
            <RelatedDoc
              icon={FileText}
              label="Source RFQ"
              value={po.custom_rfq_reference ?? "—"}
              to={po.custom_rfq_reference ? `/sourcing/rfq/${encodeURIComponent(po.custom_rfq_reference)}` : undefined}
            />
            <RelatedDoc
              icon={PackagePlus}
              label="Goods Receipts"
              value={grns.length > 0 ? `${grns.length} GRN${grns.length > 1 ? "s" : ""}` : "None"}
              to={submittedGRNs[0] ? `/warehouse/grn/${encodeURIComponent(submittedGRNs[0].name)}` : undefined}
            />
            <RelatedDoc
              icon={Receipt}
              label="Invoices"
              value={activeInvoices.length > 0 ? `${activeInvoices.length} Invoice${activeInvoices.length > 1 ? "s" : ""}` : "None"}
              to={
                primaryInvoice
                  ? `/p2p/invoices/${encodeURIComponent(primaryInvoice.name)}?fromPo=${encodeURIComponent(po.name)}`
                  : undefined
              }
            />
            <RelatedDoc
              icon={DollarSign}
              label="Payment"
              value={allInvoicesPaid ? "Paid" : hasInvoice ? "Pending" : "—"}
            />
          </SideCard>

          {/* Supplier card */}
          <Link
            to={`/suppliers/${encodeURIComponent(po.supplier ?? "")}`}
            className="group flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm transition hover:border-primary-300 hover:bg-neutral-50"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600 group-hover:bg-primary-100">
              <Building2 className="h-3 w-3" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Supplier</p>
              <p className="truncate text-xs font-semibold text-neutral-900 group-hover:text-primary-700">{po.supplier_name ?? po.supplier ?? "—"}</p>
            </div>
            <ExternalLink className="h-3 w-3 flex-shrink-0 text-neutral-300 group-hover:text-primary-500" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tab panels                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ItemsTab({
  items,
  grandTotal,
}: {
  items: Array<{ name?: string; item_code: string; item_name?: string; qty: number; rate?: number; amount?: number; uom?: string; received_qty?: number; billed_amt?: number }>;
  grandTotal: number;
}) {
  if (items.length === 0) return <p className="px-4 py-5 text-center text-xs text-neutral-500">No items on this Purchase Order.</p>;

  return (
    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-neutral-50">
          <tr className="border-b border-neutral-200">
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500 w-9">#</th>
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Item</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500 w-16">Qty</th>
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500 w-14">UOM</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500 w-24">Rate</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500 w-24">Amount</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500 w-16">Recv&apos;d</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500 w-24">Billed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.name ?? idx} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
              <td className="px-3 py-1.5 text-neutral-400">{idx + 1}</td>
              <td className="px-3 py-1.5">
                <span className="font-medium text-neutral-900">{item.item_code}</span>
                {item.item_name && item.item_name !== item.item_code && (
                  <span className="ml-1.5 text-neutral-500">{item.item_name}</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{item.qty}</td>
              <td className="px-3 py-1.5 text-neutral-500">{item.uom ?? "Nos"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(item.rate ?? 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(item.amount ?? 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-neutral-600">{item.received_qty ?? 0}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-neutral-600">{formatCurrency(item.billed_amt ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 bg-neutral-50">
          <tr className="border-t border-neutral-200">
            <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-neutral-700">Grand Total</td>
            <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-neutral-900">{formatCurrency(grandTotal)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GRNTab({ grns, poName }: {
  grns: Array<{ name: string; supplier?: string; supplier_name?: string; posting_date?: string; status?: string; grand_total?: number; docstatus?: number; modified?: string }>;
  poName: string;
}) {
  if (grns.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <PackagePlus className="mx-auto mb-1.5 h-7 w-7 text-neutral-300" />
        <p className="text-xs font-medium text-neutral-700">No Goods Receipts yet</p>
        <p className="mt-0.5 text-[11px] text-neutral-500">Create a GRN once goods are received against {poName}.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50">
          <tr className="border-b border-neutral-200">
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">GRN Number</th>
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Date</th>
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Status</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500">Total</th>
          </tr>
        </thead>
        <tbody>
          {grns.map((g) => (
            <tr key={g.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
              <td className="px-3 py-1.5"><Link to={`/warehouse/grn/${encodeURIComponent(g.name)}`} className="font-medium text-primary-600 hover:underline">{g.name}</Link></td>
              <td className="px-3 py-1.5 text-neutral-600">{g.posting_date ? formatDate(g.posting_date) : "—"}</td>
              <td className="px-3 py-1.5"><StatusBadge status={g.status ?? (g.docstatus === 1 ? "Submitted" : "Draft")} /></td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(g.grand_total ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab({
  invoices,
  poName,
}: {
  invoices: InvoiceRow[];
  poName: string;
}) {
  if (invoices.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <Receipt className="mx-auto mb-1.5 h-7 w-7 text-neutral-300" />
        <p className="text-xs font-medium text-neutral-700">No Invoices yet</p>
        <p className="mt-0.5 text-[11px] text-neutral-500">Invoices appear once goods are received and billing is initiated.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50">
          <tr className="border-b border-neutral-200">
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Invoice</th>
            <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Status</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500">Total</th>
            <th className="px-3 py-1.5 text-right font-semibold text-neutral-500">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
              <td className="px-3 py-1.5">
                <Link
                  to={`/p2p/invoices/${encodeURIComponent(inv.name)}?fromPo=${encodeURIComponent(poName)}`}
                  className="font-medium text-primary-600 hover:underline"
                >
                  {inv.name}
                </Link>
              </td>
              <td className="px-3 py-1.5"><StatusBadge status={inv.status ?? "Draft"} /></td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(inv.grand_total ?? 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(inv.outstanding_amount ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab({ entries }: { entries: Array<{ label: string; ts: string | null | undefined; done: boolean }> }) {
  return (
    <div className="px-4 py-3">
      <ol className="relative ml-2.5 border-l border-neutral-200">
        {entries.map((entry, idx) => (
          <li key={idx} className="mb-3 ml-4 last:mb-0">
            <span className={`absolute -left-[6px] flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-white ${entry.done ? "bg-success-500" : "bg-neutral-200"}`}>
              {entry.done && <CheckCircle2 className="h-1.5 w-1.5 text-white" />}
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <p className={`text-xs font-medium ${entry.done ? "text-neutral-900" : "text-neutral-400"}`}>{entry.label}</p>
              {entry.ts && <span className="flex-shrink-0 text-[10px] text-neutral-500">{formatDisplayDateTime(entry.ts)}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Shared primitives                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

function CompactStatus({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const isComplete = lower === "completed" || lower === "closed";
  const isDraftLike = lower === "draft" || lower === "to receive and bill" || lower === "to bill";
  let cls = "bg-neutral-100 text-neutral-600";
  if (isComplete) cls = "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  else if (isDraftLike) cls = "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold leading-tight ${cls}`}>
      {status}
    </span>
  );
}

function CountBadge({ n }: { n: number }) {
  return <span className="ml-0.5 rounded-full bg-neutral-100 px-1.5 py-px text-[9px] font-bold text-neutral-600">{n}</span>;
}

function InfoField({ label, value, badge, mono }: { label: string; value?: string; badge?: string; mono?: boolean }) {
  return (
    <div className="py-0.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      {badge ? (
        <StatusBadge status={badge} />
      ) : (
        <p className={`text-xs font-medium text-neutral-800 truncate leading-snug ${mono ? "font-mono" : ""}`}>{value ?? "—"}</p>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: {
  icon: typeof DollarSign; label: string; value: string;
  tone: "primary" | "success" | "warning" | "neutral";
}) {
  const accents: Record<string, string> = {
    primary: "text-primary-600 bg-primary-50",
    success: "text-success-600 bg-success-50",
    warning: "text-warning-600 bg-warning-50",
    neutral: "text-neutral-500 bg-neutral-100",
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 shadow-sm">
      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${accents[tone]}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
        <p className="text-sm font-bold tabular-nums text-neutral-900 leading-snug truncate">{value}</p>
      </div>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 bg-neutral-50/60 px-3.5 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
      </div>
      <div className="px-3.5 py-2">{children}</div>
    </div>
  );
}

function DeliveryDetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-1">
      <span className="shrink-0 text-[11px] font-medium text-neutral-500">
        {label}
      </span>
      <span className="min-w-0 text-right text-[11px] font-semibold text-neutral-900">
        {value}
      </span>
    </div>
  );
}

/** Delivery-specific badge: Pending = yellow, In Transit = blue, Delivered = green */
function DeliveryStatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let tone: "warning" | "info" | "success" | "danger" | "neutral" = "neutral";

  if (
    lower.includes("pending") ||
    lower === "accepted" ||
    lower === "to receive"
  ) {
    tone = "warning";
  } else if (lower.includes("transit")) {
    tone = "info";
  } else if (
    lower === "completed" ||
    lower === "delivered" ||
    lower.includes("partially received")
  ) {
    tone = "success";
  } else if (lower === "rejected") {
    tone = "danger";
  }

  return <StatusBadge status={status} tone={tone} />;
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <span className={`text-[11px] text-right tabular-nums truncate ${bold ? "font-bold text-neutral-900" : "font-medium text-neutral-700"}`}>{value}</span>
    </div>
  );
}

function RelatedDoc({ icon: Icon, label, value, to }: {
  icon: typeof FileText; label: string; value: string; to?: string;
}) {
  const inner = (
    <div className="flex items-center gap-2 rounded px-1 py-1 text-[11px] transition hover:bg-neutral-50">
      <Icon className="h-3 w-3 flex-shrink-0 text-neutral-400" />
      <span className="text-neutral-500">{label}</span>
      <span className={`ml-auto truncate font-medium ${to ? "text-primary-600" : "text-neutral-700"}`}>{value}</span>
    </div>
  );
  if (to) return <Link to={to} className="block">{inner}</Link>;
  return inner;
}

function ActionBtn({ icon: Icon, label, onClick, disabled, variant }: {
  icon: typeof Send; label: string; onClick: () => void; disabled?: boolean;
  variant: "primary" | "success" | "ghost";
}) {
  const cls: Record<string, string> = {
    primary: "bg-primary-600 text-white hover:bg-primary-700 shadow-sm",
    success: "bg-success-600 text-white hover:bg-success-700 shadow-sm",
    ghost: "bg-white text-neutral-600 hover:bg-neutral-50 ring-1 ring-neutral-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 cursor-pointer border-none ${cls[variant]}`}
    >
      {disabled && variant === "primary" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function SideActionBtn({ icon: Icon, label, onClick, disabled, tone }: {
  icon: typeof Send; label: string; onClick: () => void; disabled?: boolean;
  tone: "primary" | "success" | "neutral";
}) {
  const s: Record<string, string> = {
    primary: "bg-primary-600 text-white hover:bg-primary-700",
    success: "bg-success-600 text-white hover:bg-success-700",
    neutral:
      "border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${s[tone]} ${tone === "neutral" ? "" : "border-none"}`}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" /> {label}
    </button>
  );
}
