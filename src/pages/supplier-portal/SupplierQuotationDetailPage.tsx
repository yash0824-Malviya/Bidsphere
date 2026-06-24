import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  FileText,
  Hash,
  Layers,
  Lock,
  Package,
  Printer,
  ShieldCheck,
} from "lucide-react";

import { getSupplierQuotation } from "../../api/sourcing";
import type { SupplierQuotation } from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import SupplierPortalLayout from "./SupplierPortalLayout";

/* -------------------------------------------------------------------------- */
/*  Helper sub-components                                                      */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.FC<{ className?: string }>;
}) {
  return (
    <div className="flex items-start gap-2">
      {Icon && (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-500">{label}</p>
        <p className="text-sm text-neutral-900">{children}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.FC<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
      <Icon className="h-4 w-4 text-neutral-500" />
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  PDF builder (lightweight — no jsPDF dependency required)                   */
/* -------------------------------------------------------------------------- */

function downloadQuotationCSV(sq: SupplierQuotation) {
  const items = sq.items ?? [];
  const header = "Item Code,Item Name,Description,Qty,UOM,Unit Price,Line Total";
  const rows = items.map((it) => {
    const lineTotal = it.amount ?? it.rate * it.qty;
    const desc = (it.description ?? "").replace(/,/g, ";").replace(/\n/g, " ");
    return `${it.item_code},"${it.item_name ?? ""}","${desc}",${it.qty},${it.uom ?? "Nos"},${it.rate},${lineTotal}`;
  });
  const grandTotal = sq.grand_total ?? sq.total ?? 0;
  rows.push(`,,,,,,Grand Total: ${grandTotal}`);

  const blob = new Blob(
    [`Supplier Quotation: ${sq.name}\nSupplier: ${sq.supplier_name ?? sq.supplier}\nDate: ${sq.transaction_date ?? ""}\n\n${header}\n${rows.join("\n")}\n`],
    { type: "text/csv" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sq.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function SupplierQuotationDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sqName = decodeURIComponent(id);

  // eslint-disable-next-line no-console
  console.log("[SQ Detail] Quotation ID clicked:", sqName);

  /* ── Session gate ── */
  const [supplierName, setSupplierName] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("supplier_session");
    if (!raw) {
      navigate("/supplier/login", { replace: true });
      return;
    }
    try {
      const session = JSON.parse(raw) as { supplierName?: string };
      setSupplierName(session.supplierName ?? null);
    } catch {
      navigate("/supplier/login", { replace: true });
    }
  }, [navigate]);

  /* ── Fetch quotation from ERPNext ── */
  const sqQuery = useQuery<SupplierQuotation>({
    queryKey: ["supplier-quotation-detail", sqName],
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[SQ Detail] Fetching from ERPNext: Supplier Quotation", sqName);
      const result = await getSupplierQuotation(sqName);
      // eslint-disable-next-line no-console
      console.log("[SQ Detail] ERPNext API response:", {
        name: result.name,
        supplier: result.supplier,
        supplier_name: result.supplier_name,
        status: result.status,
        docstatus: (result as { docstatus?: number }).docstatus,
        item_count: (result.items ?? []).length,
        grand_total: result.grand_total,
        total: result.total,
      });
      return result;
    },
    enabled: !!sqName && !!supplierName,
    retry: false,
  });

  const sq = sqQuery.data;
  const items = sq?.items ?? [];
  const subtotal = items.reduce((s, it) => s + (it.amount ?? it.rate * it.qty), 0);
  const grandTotal = sq?.grand_total ?? sq?.total ?? subtotal;
  const tax = grandTotal - subtotal;

  // Log grand total verification when data is ready
  useEffect(() => {
    if (!sq) return;
    const computedSubtotal = (sq.items ?? []).reduce(
      (s, it) => s + (it.amount ?? it.rate * it.qty),
      0
    );
    // eslint-disable-next-line no-console
    console.log("[SQ Detail] Grand Total Verification:", {
      quotation: sq.name,
      erpnext_grand_total: sq.grand_total,
      erpnext_total: sq.total,
      computed_subtotal: computedSubtotal,
      displayed_grand_total: sq.grand_total ?? sq.total ?? computedSubtotal,
      item_count: (sq.items ?? []).length,
    });
  }, [sq]);

  const rfqRef =
    sq?.rfq_no ??
    (items.find(
      (it) => (it as { request_for_quotation?: string }).request_for_quotation
    ) as { request_for_quotation?: string } | undefined)?.request_for_quotation ??
    null;

  const docstatus = (sq as { docstatus?: number } | undefined)?.docstatus;
  const statusLabel =
    sq?.status ??
    (docstatus === 1 ? "Submitted" : docstatus === 0 ? "Draft" : "Unknown");
  const isSubmitted = docstatus === 1 || statusLabel === "Submitted";

  /* ── Access guard ── */
  const accessDenied =
    sq &&
    supplierName &&
    sq.supplier !== supplierName &&
    (sq.supplier_name ?? "").toLowerCase() !== supplierName.toLowerCase();

  /* ── Loading ── */
  if (!supplierName || sqQuery.isLoading) {
    return (
      <SupplierPortalLayout>
        <div className="space-y-4 p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </SupplierPortalLayout>
    );
  }

  /* ── Error / not found ── */
  if (sqQuery.isError || !sq) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <Link
          to="/supplier/quotations"
          className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Quotations
        </Link>
        <EmptyState
          icon={FileText}
          title="Quotation not found"
          description={`Supplier Quotation "${sqName}" could not be loaded. It may have been deleted or you may not have access to view it.`}
        />
      </SupplierPortalLayout>
    );
  }

  /* ── Access denied ── */
  if (accessDenied) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <Link
          to="/supplier/quotations"
          className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Quotations
        </Link>
        <EmptyState
          icon={ShieldCheck}
          title="Access denied"
          description="This quotation belongs to a different supplier."
        />
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      {/* Back link */}
      <Link
        to="/supplier/quotations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Quotations
      </Link>

      {/* Read-only banner for submitted quotations */}
      {isSubmitted && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Lock className="h-4 w-4 text-blue-600" />
          <p className="text-sm font-medium text-blue-800">
            This quotation has been submitted and is in read-only mode.
          </p>
        </div>
      )}

      {/* Page header with actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{sq.name}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Supplier Quotation Details
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={statusLabel} />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            type="button"
            onClick={() => downloadQuotationCSV(sq)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {/* ── Header Card ── */}
        <section className="card">
          <SectionHeader title="Quotation Information" icon={FileText} />
          <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Quotation Number" icon={Hash}>{sq.name}</Field>
            <Field label="RFQ Number" icon={FileText}>
              {rfqRef ? (
                <Link
                  to={`/supplier/rfq/${encodeURIComponent(rfqRef)}`}
                  className="text-accent-700 hover:underline"
                >
                  {rfqRef}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Supplier Name" icon={Package}>
              {sq.supplier_name ?? sq.supplier}
            </Field>
            <Field label="Submission Date" icon={Calendar}>
              {sq.transaction_date ? formatDate(sq.transaction_date) : "—"}
            </Field>
            <Field label="Status" icon={ShieldCheck}>
              <StatusBadge status={statusLabel} />
            </Field>
            <Field label="Company" icon={Layers}>
              {sq.company ?? "—"}
            </Field>
          </div>
        </section>

        {/* ── Commercial Summary ── */}
        <section className="card">
          <SectionHeader title="Commercial Details" icon={Layers} />
          <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-3">
              <p className="text-xs font-medium text-primary-600">Grand Total (USD)</p>
              <p className="mt-1 text-lg font-bold text-primary-900">
                {formatCurrency(grandTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-500">Payment Terms</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">
                {(sq as { payment_terms_template?: string }).payment_terms_template || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-500">Delivery Days</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">
                {items[0]?.delivery_days ? `${items[0].delivery_days} days` : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-500">Quote Valid Until</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900">
                {sq.valid_till ? formatDate(sq.valid_till) : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* ── Items Table ── */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-neutral-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Item Details
              </h3>
            </div>
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {items.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-neutral-400">
              No line items found for this quotation.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Item Code</th>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3">UOM</th>
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    <th className="px-4 py-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {items.map((it, idx) => {
                    const lineTotal = it.amount ?? it.rate * it.qty;
                    return (
                      <tr key={it.name ?? idx} className="hover:bg-neutral-50/60">
                        <td className="px-4 py-3 text-neutral-400">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          {it.item_code}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {it.item_name ?? "—"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-neutral-500">
                          {it.description ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                          {it.qty}
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {it.uom ?? "Nos"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                          {formatCurrency(it.rate)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                          {formatCurrency(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals */}
          {items.length > 0 && (
            <div className="border-t border-neutral-200 bg-neutral-50 px-5 py-4">
              <div className="ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
                <div className="flex justify-between text-neutral-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(subtotal)}</span>
                </div>
                {tax > 0.01 && (
                  <div className="flex justify-between text-neutral-600">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatCurrency(tax)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-neutral-300 pt-1.5 font-bold text-neutral-900">
                  <span>Grand Total</span>
                  <span className="tabular-nums">{formatCurrency(grandTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Notes / Terms ── */}
        {(sq.notes || (sq as { terms?: string }).terms) && (
          <section className="card">
            <SectionHeader title="Notes & Terms" icon={FileText} />
            <div className="space-y-3 p-5 text-sm text-neutral-700 whitespace-pre-line">
              {sq.notes && <p>{sq.notes}</p>}
              {(sq as { terms?: string }).terms && (
                <p>{(sq as { terms?: string }).terms}</p>
              )}
            </div>
          </section>
        )}

        {/* ── Audit Information ── */}
        <section className="card">
          <SectionHeader title="Audit Information" icon={Clock} />
          <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-3">
            <Field label="Created On" icon={Calendar}>
              {sq.creation ? formatDateTime(sq.creation) : "—"}
            </Field>
            <Field label="Submitted On" icon={Calendar}>
              {sq.transaction_date ? formatDate(sq.transaction_date) : "—"}
            </Field>
            <Field label="Last Modified" icon={Clock}>
              {sq.modified ? formatDateTime(sq.modified) : "—"}
            </Field>
          </div>
        </section>
      </div>
    </SupplierPortalLayout>
  );
}
