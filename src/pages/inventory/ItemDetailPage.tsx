import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  Warehouse,
} from "lucide-react";

import { apiGet } from "../../api/erpnext";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import type { Bin, Item } from "../../types/erpnext";
import { formatCurrency, formatDateTime, formatNumber } from "../../utils/format";

interface StockLedgerEntry {
  name: string;
  posting_date: string;
  posting_time?: string;
  warehouse: string;
  voucher_type: string;
  voucher_no: string;
  actual_qty: number;
  qty_after_transaction?: number;
  valuation_rate?: number;
  stock_uom?: string;
}

export default function ItemDetailPage() {
  const { code = "" } = useParams();
  const decodedCode = decodeURIComponent(code);

  const itemQuery = useQuery<Item>({
    queryKey: ["item", decodedCode],
    enabled: !!decodedCode,
    queryFn: () =>
      apiGet<Item>(
        `/api/resource/Item/${encodeURIComponent(decodedCode)}`
      ),
  });

  const binsQuery = useQuery<Bin[]>({
    queryKey: ["item-bins", decodedCode],
    enabled: !!decodedCode,
    queryFn: () =>
      apiGet<Bin[]>("/api/resource/Bin", {
        params: {
          filters: JSON.stringify([["item_code", "=", decodedCode]]),
          fields: JSON.stringify([
            "name",
            "item_code",
            "warehouse",
            "actual_qty",
            "reserved_qty",
            "ordered_qty",
            "projected_qty",
            "valuation_rate",
            "stock_value",
          ]),
          limit_page_length: 200,
          order_by: "actual_qty desc",
        },
      }),
  });

  const movementsQuery = useQuery<StockLedgerEntry[]>({
    queryKey: ["item-movements", decodedCode],
    enabled: !!decodedCode,
    queryFn: () =>
      apiGet<StockLedgerEntry[]>("/api/resource/Stock Ledger Entry", {
        params: {
          filters: JSON.stringify([
            ["item_code", "=", decodedCode],
            ["is_cancelled", "=", 0],
          ]),
          fields: JSON.stringify([
            "name",
            "posting_date",
            "posting_time",
            "warehouse",
            "voucher_type",
            "voucher_no",
            "actual_qty",
            "qty_after_transaction",
            "valuation_rate",
            "stock_uom",
          ]),
          order_by: "posting_date desc, posting_time desc",
          limit_page_length: 50,
        },
      }),
  });

  if (itemQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <div>
        <Link
          to="/inventory"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <ErrorState
          icon={Boxes}
          title="Item not found"
          description="It may have been deleted, or you may not have access."
          onRetry={() => itemQuery.refetch()}
        />
      </div>
    );
  }

  const item = itemQuery.data;
  const totalStock = (binsQuery.data ?? []).reduce(
    (s, b) => s + (b.actual_qty ?? 0),
    0
  );
  const reorder = item.safety_stock ?? 0;
  const isBelow = reorder > 0 && totalStock < reorder;

  return (
    <div>
      <Link
        to="/inventory"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inventory
      </Link>

      <PageHeader
        title={item.item_name}
        description={item.item_code}
        actions={
          isBelow && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 px-2.5 py-0.5 text-xs font-medium text-danger-700 ring-1 ring-inset ring-danger-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Below reorder
            </span>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard
          label="Total Stock"
          value={formatNumber(totalStock)}
          unit={item.stock_uom}
          tone={isBelow ? "danger" : "primary"}
        />
        <InfoCard
          label="Reorder Level"
          value={reorder > 0 ? formatNumber(reorder) : "—"}
          unit={reorder > 0 ? item.stock_uom : undefined}
        />
        <InfoCard label="Item Group" value={item.item_group ?? "—"} />
        <InfoCard label="UOM" value={item.stock_uom ?? "—"} />
      </div>

      {item.description && (
        <div className="mt-4 card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900">Description</h3>
          <p className="mt-2 text-sm text-neutral-600 whitespace-pre-line">
            {item.description}
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="card lg:col-span-2">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Stock by Warehouse
            </h3>
          </div>
          {binsQuery.isError ? (
            <ErrorState
              icon={Warehouse}
              title="Could not load stock"
              onRetry={() => binsQuery.refetch()}
            />
          ) : binsQuery.isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (binsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="No stock entries"
              description="This item is not yet present in any warehouse."
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(binsQuery.data ?? []).map((b) => (
                <li
                  key={`${b.warehouse}-${b.name}`}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Warehouse className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {b.warehouse}
                      </p>
                      {b.projected_qty !== undefined && (
                        <p className="text-xs text-neutral-500">
                          Projected:{" "}
                          {formatNumber(b.projected_qty)} {item.stock_uom}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-neutral-900">
                      {formatNumber(b.actual_qty)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {item.stock_uom ?? ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card lg:col-span-3">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Recent Stock Movements
            </h3>
            <p className="text-xs text-neutral-500">
              Latest 50 ledger entries against this item.
            </p>
          </div>
          {movementsQuery.isError ? (
            <ErrorState
              title="Could not load movements"
              onRetry={() => movementsQuery.refetch()}
            />
          ) : movementsQuery.isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : (movementsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No movements yet"
              description="Stock receipts and issues will appear here once recorded."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Warehouse</th>
                    <th className="px-4 py-2">Voucher</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {(movementsQuery.data ?? []).map((m) => {
                    const isIn = m.actual_qty > 0;
                    return (
                      <tr key={m.name} className="hover:bg-neutral-50">
                        <td className="px-4 py-2 text-neutral-600 whitespace-nowrap">
                          {formatDateTime(
                            `${m.posting_date}T${m.posting_time ?? "00:00:00"}`
                          )}
                        </td>
                        <td className="px-4 py-2 text-neutral-600">
                          {m.warehouse}
                        </td>
                        <td className="px-4 py-2 text-neutral-700">
                          <div className="text-xs text-neutral-500">
                            {m.voucher_type}
                          </div>
                          <div className="font-medium">{m.voucher_no}</div>
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-medium tabular-nums ${
                            isIn ? "text-accent-700" : "text-danger-600"
                          }`}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            {isIn ? (
                              <ArrowUpRight className="h-3 w-3" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3" />
                            )}
                            {isIn ? "+" : ""}
                            {formatNumber(m.actual_qty)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                          {formatNumber(m.qty_after_transaction ?? 0)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                          {m.valuation_rate
                            ? formatCurrency(m.valuation_rate)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  label,
  value,
  unit,
  tone = "primary",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "primary" | "danger";
}) {
  const valueClass =
    tone === "danger" ? "text-danger-600" : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal text-neutral-500">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
