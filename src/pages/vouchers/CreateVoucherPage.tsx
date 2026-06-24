import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Lock, Send, Save } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { getGRNsForPO, getPurchaseOrder, getPurchaseOrders } from "../../api/purchasing";
import { createVoucher, sendVoucherToSupplier } from "../../api/vouchers";
import { canManageVouchers } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import type { VoucherItem } from "../../types/voucher";
import { formatCurrency } from "../../utils/format";

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 45", "Net 60", "Net 90"] as const;

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export default function CreateVoucherPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = canManageVouchers(role);

  const [poName, setPoName] = useState("");
  const [grnName, setGrnName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<string>("Net 30");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: pos = [], isLoading: posLoading } = useQuery({
    queryKey: ["po-list-for-voucher"],
    queryFn: () => getPurchaseOrders({ limit_page_length: 100 }),
    staleTime: 60_000,
  });

  // Full PO (with items + supplier) once one is selected.
  const { data: po, isFetching: poFetching } = useQuery({
    queryKey: ["po-detail-for-voucher", poName],
    enabled: !!poName,
    queryFn: () => getPurchaseOrder(poName),
  });

  const { data: grns = [] } = useQuery({
    queryKey: ["grns-for-voucher", poName],
    enabled: !!poName,
    queryFn: () => getGRNsForPO(poName),
  });

  const items: VoucherItem[] = (po?.items ?? []).map((it) => ({
    item_code: it.item_code,
    item_name: it.item_name ?? it.item_code,
    qty: it.qty,
    rate: it.rate,
    amount: it.amount ?? it.rate * it.qty,
    uom: it.uom ?? "Nos",
  }));
  const amount = po?.grand_total ?? items.reduce((s, it) => s + it.amount, 0);

  async function handleCreate(sendNow: boolean) {
    if (!canManage) {
      toast.error("Only the Finance team can create vouchers.");
      return;
    }
    if (!poName || !po) {
      toast.error("Select a Purchase Order first.");
      return;
    }
    setSubmitting(true);
    try {
      const voucher = createVoucher({
        po_reference: poName,
        grn_reference: grnName,
        supplier: po.supplier,
        supplier_name: po.supplier_name ?? po.supplier,
        amount,
        currency: po.currency ?? "USD",
        items,
        payment_terms: paymentTerms,
        due_date: dueDate || undefined,
        notes: notes || undefined,
      });
      if (sendNow) {
        sendVoucherToSupplier(voucher.id);
        toast.success(`Voucher ${voucher.id} created and sent to supplier.`);
      } else {
        toast.success(`Voucher ${voucher.id} saved as draft.`);
      }
      navigate(`/p2p/vouchers/${encodeURIComponent(voucher.id)}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create the voucher."
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Defense-in-depth: the route guard already blocks non-Finance roles from
  // reaching this screen, but if one arrives anyway (stale tab, direct link),
  // show a read-only access notice instead of the creation form.
  if (!canManage) {
    return (
      <div>
        <Link
          to="/p2p/vouchers"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back to vouchers
        </Link>
        <EmptyState
          icon={Lock}
          title="Read-only access"
          description="Vouchers are created and managed by the Finance team. You can view existing vouchers, but you cannot create new ones."
        />
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/p2p/vouchers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to vouchers
      </Link>

      <PageHeader
        title="Create Voucher"
        description="Issue a voucher to a supplier from an existing Purchase Order and Goods Receipt."
      />

      <div className="space-y-6">
        <div className="card">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">Source</h3>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                Purchase Order<span className="text-danger-500">*</span>
              </label>
              <select
                value={poName}
                onChange={(e) => {
                  setPoName(e.target.value);
                  setGrnName("");
                }}
                className={inputClass}
                disabled={posLoading}
              >
                <option value="">
                  {posLoading ? "Loading…" : "Select a Purchase Order…"}
                </option>
                {pos.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} — {p.supplier} ({formatCurrency(p.grand_total)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                Goods Receipt (GRN)
              </label>
              <select
                value={grnName}
                onChange={(e) => setGrnName(e.target.value)}
                className={inputClass}
                disabled={!poName}
              >
                <option value="">
                  {!poName ? "Select a PO first" : "Optional — link a GRN…"}
                </option>
                {grns.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                    {g.status ? ` (${g.status})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {poName && (
          <div className="card">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-neutral-900">
                Voucher Details
              </h3>
              {poFetching && (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              )}
            </div>
            <div className="p-5">
              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                <Field label="Supplier">
                  {po?.supplier_name ?? po?.supplier ?? "—"}
                </Field>
                <Field label="Currency">{po?.currency ?? "USD"}</Field>
                <Field label="Amount">
                  <span className="font-semibold text-neutral-900">
                    {formatCurrency(amount)}
                  </span>
                </Field>
              </div>

              {items.length > 0 && (
                <div className="mb-5 overflow-x-auto rounded-lg border border-neutral-200">
                  <table className="min-w-full divide-y divide-neutral-200 text-sm">
                    <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="px-4 py-2">Item</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-right">Rate</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {items.map((it) => (
                        <tr key={it.item_code}>
                          <td className="px-4 py-2 font-medium text-neutral-900">
                            {it.item_name}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {it.qty} {it.uom}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatCurrency(it.rate)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatCurrency(it.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                    Payment Terms
                  </label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className={inputClass}
                  >
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                    Notes for Supplier
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Optional message to the supplier…"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleCreate(false)}
            disabled={!poName || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => void handleCreate(true)}
            disabled={!poName || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Create &amp; Send to Supplier
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-900">{children}</p>
    </div>
  );
}
