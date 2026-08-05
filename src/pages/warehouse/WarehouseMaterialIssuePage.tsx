import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Loader2,
  PackageCheck,
  Save,
  X,
} from "lucide-react";

import {
  clearMaterialIssueDraft,
  executeMaterialIssue,
  loadMaterialIssueDraft,
  resolveIssueType,
  saveMaterialIssueDraft,
  stockStatusForLine,
  validateIssueLines,
  type ReceiverRole,
} from "../../api/materialIssue";
import { createMaterialIssueReceipt } from "../../api/materialIssueReceipt";
import {
  resolveMaterialIssueWarehouses,
  WAREHOUSE_MODULE_COMPANY,
} from "../../api/warehouseCompany";
import { getItemWarehouseStock } from "../../api/warehouseInventoryService";
import { getMaterialRequestDetail } from "../../services/warehouseService";
import { queryClient } from "../../queryClient";
import MaterialIssueSlipPreview from "../../components/warehouse/MaterialIssueSlipPreview";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { useAuthStore } from "../../store/authStore";
import { todayIso } from "../../utils/format";
import type { MaterialIssuePdfData } from "../../utils/pdf/materialIssuePdf";

interface LineState {
  item_code: string;
  item_name: string;
  warehouse: string;
  bin: string;
  batch: string;
  uom: string;
  required_qty: number;
  available_qty: number;
  issue_qty: number;
  remarks: string;
}

function StatusPill({
  status,
}: {
  status: "Available" | "Partial Stock" | "Out of Stock";
}) {
  const cls =
    status === "Available"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "Partial Stock"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : "border-rose-200 bg-rose-50 text-rose-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

export default function WarehouseMaterialIssuePage() {
  const { mrName: rawMr = "" } = useParams();
  const mrName = decodeURIComponent(rawMr);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [lines, setLines] = useState<LineState[]>([]);
  const [receiver, setReceiver] = useState<ReceiverRole>("Department User");
  const [remarks, setRemarks] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successEntry, setSuccessEntry] = useState<string | null>(null);
  /** User-selected (or auto-selected) From Warehouse for Stock Entry. */
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [stockRefreshing, setStockRefreshing] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["warehouse", "material-issue-prep", mrName],
    queryFn: () => getMaterialRequestDetail(mrName),
    enabled: !!mrName,
    retry: false,
  });

  const warehousesQuery = useQuery({
    queryKey: [
      "warehouse",
      "material-issue-warehouses",
      detailQuery.data?.company || WAREHOUSE_MODULE_COMPANY,
    ],
    queryFn: () =>
      resolveMaterialIssueWarehouses(
        detailQuery.data?.company || WAREHOUSE_MODULE_COMPANY,
      ),
    enabled: !!detailQuery.data,
    staleTime: 60_000,
    retry: 1,
  });

  const warehouseOptions = warehousesQuery.data?.warehouses ?? [];
  const mrCompany =
    warehousesQuery.data?.company ||
    detailQuery.data?.company ||
    WAREHOUSE_MODULE_COMPANY;

  // Auto-select when only one Netlink warehouse; otherwise keep user choice.
  useEffect(() => {
    const data = warehousesQuery.data;
    if (!data) return;
    if (data.warehouses.length === 1) {
      setFromWarehouse(data.warehouses[0]!);
      return;
    }
    setFromWarehouse((prev) => {
      if (prev && data.warehouses.includes(prev)) return prev;
      // Multiple: do not hardcode — leave empty until user picks.
      return "";
    });
  }, [warehousesQuery.data]);

  useEffect(() => {
    const mr = detailQuery.data;
    if (!mr) return;
    const draft = loadMaterialIssueDraft(mr.name);
    const draftQty = new Map(
      (draft?.lines ?? []).map((l) => [l.item_code, l.issue_qty]),
    );
    const draftRemarks = new Map(
      (draft?.lines ?? []).map((l) => [l.item_code, l.remarks || ""]),
    );
    setLines(
      (mr.items ?? []).map((it) => {
        const required = Math.max(0, Number(it.required_qty) || 0);
        const available = Math.max(0, Number(it.available_qty) || 0);
        const defaultIssue = Math.min(required, available);
        return {
          item_code: it.item_code,
          item_name: it.description || it.item_code,
          warehouse: fromWarehouse || it.warehouse || "—",
          bin: fromWarehouse || it.warehouse || "—",
          batch: "—",
          uom: it.uom || "Nos",
          required_qty: required,
          available_qty: available,
          issue_qty: draftQty.has(it.item_code)
            ? Number(draftQty.get(it.item_code)) || 0
            : defaultIssue,
          remarks: draftRemarks.get(it.item_code) || "",
        };
      }),
    );
    if (draft?.receiver) setReceiver(draft.receiver);
    if (draft?.remarks) setRemarks(draft.remarks);
    // Only re-init lines when MR detail loads — warehouse changes handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.data]);

  // When From Warehouse is set, refresh Available Qty from that warehouse's Bin.
  useEffect(() => {
    const mr = detailQuery.data;
    if (!fromWarehouse || !mr?.items?.length) return;

    let cancelled = false;
    void (async () => {
      setStockRefreshing(true);
      try {
        const draft = loadMaterialIssueDraft(mr.name);
        const draftQty = new Map(
          (draft?.lines ?? []).map((l) => [l.item_code, l.issue_qty]),
        );
        const next = await Promise.all(
          (mr.items ?? []).map(async (it) => {
            const required = Math.max(0, Number(it.required_qty) || 0);
            let available = 0;
            try {
              const stock = await getItemWarehouseStock(
                it.item_code,
                fromWarehouse,
              );
              available = Math.max(0, stock.available_qty);
            } catch {
              available = 0;
            }
            const defaultIssue = Math.min(required, available);
            const issue_qty = draftQty.has(it.item_code)
              ? Math.min(
                  Number(draftQty.get(it.item_code)) || 0,
                  available,
                  required,
                )
              : defaultIssue;
            return {
              item_code: it.item_code,
              item_name: it.description || it.item_code,
              warehouse: fromWarehouse,
              bin: fromWarehouse,
              batch: "—",
              uom: it.uom || "Nos",
              required_qty: required,
              available_qty: available,
              issue_qty,
              remarks:
                draft?.lines?.find((l) => l.item_code === it.item_code)
                  ?.remarks || "",
            } satisfies LineState;
          }),
        );
        if (!cancelled) setLines(next);
      } finally {
        if (!cancelled) setStockRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromWarehouse, detailQuery.data]);

  const issueType = useMemo(() => resolveIssueType(lines), [lines]);
  const issuedBy =
    user?.full_name || user?.name || user?.email || "Warehouse Manager";

  const updateLine = (code: string, patch: Partial<LineState>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.item_code !== code) return l;
        const next = { ...l, ...patch };
        if (patch.issue_qty != null) {
          let qty = Number(patch.issue_qty) || 0;
          if (qty < 0) qty = 0;
          if (qty > next.available_qty) qty = next.available_qty;
          if (qty > next.required_qty) qty = next.required_qty;
          next.issue_qty = qty;
        }
        return next;
      }),
    );
  };

  const previewData = useMemo<MaterialIssuePdfData>(
    () => ({
      issue_number: "MAT-STE-TEMP (assigned on submit)",
      mr_name: mrName,
      department: detailQuery.data?.department || "—",
      warehouse: fromWarehouse || "—",
      issued_by: issuedBy,
      receiver,
      issue_date: todayIso(),
      issue_type: issueType,
      remarks,
      temporary: true,
      items: lines.map((l) => ({
        item_code: l.item_code,
        item_name: l.item_name,
        required_qty: l.required_qty,
        issued_qty: l.issue_qty,
        remaining_qty: Math.max(0, l.required_qty - l.issue_qty),
        uom: l.uom,
      })),
    }),
    [
      mrName,
      detailQuery.data?.department,
      fromWarehouse,
      issuedBy,
      receiver,
      issueType,
      remarks,
      lines,
    ],
  );

  const issueMut = useMutation({
    mutationFn: () =>
      executeMaterialIssue({
        mrName,
        lines: lines.map((l) => ({
          item_code: l.item_code,
          item_name: l.item_name,
          warehouse: fromWarehouse,
          uom: l.uom,
          required_qty: l.required_qty,
          available_qty: l.available_qty,
          issue_qty: l.issue_qty,
          remarks: l.remarks,
          batch: l.batch,
          bin: fromWarehouse,
        })),
        receiver,
        remarks,
        issuedBy,
        warehouse: fromWarehouse,
      }),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      void queryClient.invalidateQueries({
        queryKey: ["material-request", mrName],
      });
      setSuccessEntry(res.stock_entry);
      try {
        const receipt = await createMaterialIssueReceipt({
          stock_entry: res.stock_entry,
          mr_name: mrName,
          department:
            detailQuery.data?.department ||
            (detailQuery.data as { custom_department?: string } | undefined)
              ?.custom_department ||
            "General",
          warehouse: fromWarehouse || res.audit.warehouse || "",
          issued_by: issuedBy,
          receiver,
          issue_type: res.issue_type,
          remarks,
          lines: lines
            .filter((l) => l.issue_qty > 0)
            .map((l) => ({
              item_code: l.item_code,
              item_name: l.item_name,
              required_qty: l.required_qty,
              issued_qty: l.issue_qty,
              uom: l.uom,
              remarks: l.remarks,
            })),
        });
        void queryClient.invalidateQueries({
          queryKey: ["material-issue-receipts"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["department-issued-items"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["mr-dashboard-rows"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["material-request"],
        });
        toast.success(
          "Material issued. Receipt sent for Department acceptance.",
        );
        navigate(
          `/warehouse/material-issue-receipts/${encodeURIComponent(receipt.issue_number)}`,
        );
      } catch (receiptErr) {
        toast.error(
          receiptErr instanceof Error
            ? receiptErr.message
            : "Issue succeeded but receipt could not be created.",
        );
      }
    },
    onError: (e: Error) => {
      toast.error(e.message || "Material Issue failed.");
    },
  });

  const validateBeforeIssue = (): string | null => {
    if (!fromWarehouse) {
      return warehouseOptions.length > 1
        ? "Select a From Warehouse before issuing material."
        : `No warehouse found for Company ${mrCompany}. Configure a warehouse before issuing material.`;
    }
    return validateIssueLines(
      lines.map((l) => ({
        item_code: l.item_code,
        required_qty: l.required_qty,
        available_qty: l.available_qty,
        issue_qty: l.issue_qty,
      })),
    );
  };

  const onPreview = () => {
    const err = validateBeforeIssue();
    if (err) {
      toast.error(err);
      return;
    }
    setPreviewOpen(true);
  };

  const onSaveDraft = () => {
    saveMaterialIssueDraft({
      mrName,
      receiver,
      remarks,
      lines: lines.map((l) => ({
        item_code: l.item_code,
        issue_qty: l.issue_qty,
        remarks: l.remarks,
      })),
      saved_at: new Date().toISOString(),
    });
    toast.success("Draft saved locally.");
  };

  const onIssue = () => {
    const err = validateBeforeIssue();
    if (err) {
      toast.error(err);
      return;
    }
    setConfirmOpen(true);
  };

  if (detailQuery.isLoading || warehousesQuery.isLoading) {
    return (
      <div className="p-6">
        <TableSkeleton rows={8} columns={8} />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load Material Request"
          description="This request could not be prepared for Material Issue."
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  if (warehousesQuery.isError) {
    return (
      <div className="p-4">
        <ErrorState
          title="Unable to load warehouses"
          description={
            warehousesQuery.error instanceof Error
              ? warehousesQuery.error.message
              : `Could not load warehouses for Company ${mrCompany}.`
          }
          onRetry={() => void warehousesQuery.refetch()}
        />
      </div>
    );
  }

  const mr = detailQuery.data;
  const singleWarehouse = warehouseOptions.length === 1;

  if (successEntry) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 animate-in zoom-in">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900">
          Material Issued Successfully
        </h2>
        <p className="text-sm text-slate-500">
          Issue Number{" "}
          <span className="font-mono font-semibold text-slate-800">
            {successEntry}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            to={`/warehouse/material-requests/issued/${encodeURIComponent(successEntry)}`}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white no-underline hover:bg-primary-700"
          >
            View Issue Details
          </Link>
          <Link
            to="/warehouse/issue-items"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50"
          >
            Back to Ready to Issue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5 pb-28">
      <nav className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
        <Link to="/warehouse/dashboard" className="hover:text-primary-700">
          Warehouse
        </Link>
        <span>›</span>
        <Link to="/warehouse/issue-items" className="hover:text-primary-700">
          Issue Items
        </Link>
        <span>›</span>
        <span className="font-medium text-slate-800">Material Issue</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
            Material Issue
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Issue available stock against Material Request with full or partial
            quantities.
          </p>
        </div>
        <Link
          to="/warehouse/issue-items"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 no-underline hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </Link>
      </div>

      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Material Request
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold text-primary-700">
              {mr.name}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Company
            </dt>
            <dd className="mt-0.5 text-sm font-medium">{mrCompany}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Department
            </dt>
            <dd className="mt-0.5 text-sm font-medium">{mr.department}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              From Warehouse
            </dt>
            <dd className="mt-0.5 text-sm font-medium">
              {fromWarehouse || (
                <span className="text-amber-600">Select warehouse</span>
              )}
              {stockRefreshing ? (
                <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-slate-400" />
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issue Date
            </dt>
            <dd className="mt-0.5 text-sm font-medium">{todayIso()}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issue Type
            </dt>
            <dd className="mt-0.5">
              <span
                className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  issueType === "Full Issue"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {issueType}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {/* From Warehouse selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block max-w-xl">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            From Warehouse <span className="text-rose-500">*</span>
          </span>
          {singleWarehouse ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
              {fromWarehouse}
              <span className="ml-2 text-[11px] font-normal text-slate-500">
                (auto-selected — only warehouse for {mrCompany})
              </span>
            </div>
          ) : (
            <select
              value={fromWarehouse}
              onChange={(e) => setFromWarehouse(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
            >
              <option value="">Select From Warehouse…</option>
              {warehouseOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          )}
          <p className="mt-1.5 text-[11px] text-slate-500">
            Stock Entry will issue from this warehouse. Only warehouses for
            Company {mrCompany} are listed (Company Bidsphere warehouses are
            never used).
          </p>
        </label>
      </div>

      {/* Item table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-3">Item Code</th>
                <th className="px-3 py-3">Item Name</th>
                <th className="px-3 py-3">Warehouse</th>
                <th className="px-3 py-3">Bin</th>
                <th className="px-3 py-3">Batch</th>
                <th className="px-3 py-3 text-right">Required Qty</th>
                <th className="px-3 py-3 text-right">Available Qty</th>
                <th className="px-3 py-3 text-right">Issue Qty</th>
                <th className="px-3 py-3 text-right">Remaining Qty</th>
                <th className="px-3 py-3">Stock Status</th>
                <th className="px-3 py-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => {
                const status = stockStatusForLine(
                  l.available_qty,
                  l.required_qty,
                );
                const remaining = Math.max(0, l.required_qty - l.issue_qty);
                return (
                  <tr key={l.item_code} className="hover:bg-slate-50/70">
                    <td className="px-3 py-3 font-mono font-medium text-slate-800">
                      {l.item_code}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-slate-700">
                      {l.item_name}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {fromWarehouse || l.warehouse}
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {fromWarehouse || l.bin}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{l.batch}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {l.required_qty}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {l.available_qty}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        max={Math.min(l.available_qty, l.required_qty)}
                        step="any"
                        value={l.issue_qty}
                        disabled={l.available_qty <= 0 || !fromWarehouse}
                        onChange={(e) =>
                          updateLine(l.item_code, {
                            issue_qty: Number(e.target.value),
                          })
                        }
                        className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-right text-[12px] outline-none focus:border-primary-400 disabled:bg-slate-50"
                      />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      {remaining}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={status} />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        value={l.remarks}
                        onChange={(e) =>
                          updateLine(l.item_code, { remarks: e.target.value })
                        }
                        placeholder="—"
                        className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-primary-400"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom section */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Receiver
          </span>
          <select
            value={receiver}
            onChange={(e) => setReceiver(e.target.value as ReceiverRole)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
          >
            <option value="Department User">Department User</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Operator">Operator</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Remarks
          </span>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional issue remarks…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
          />
        </label>
      </div>

      {/* Sticky actions */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur md:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              clearMaterialIssueDraft(mrName);
              navigate("/warehouse/issue-items");
            }}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveDraft}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <Save className="h-4 w-4" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={onPreview}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" />
            Preview Issue Slip
          </button>
          <button
            type="button"
            disabled={issueMut.isPending || !fromWarehouse}
            onClick={onIssue}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {issueMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PackageCheck className="h-4 w-4" />
            )}
            Issue Material
          </button>
        </div>
      </div>

      <MaterialIssueSlipPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        data={previewData}
      />

      {/* Confirmation dialog — shows selected From Warehouse */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="issue-confirm-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="issue-confirm-title"
                className="text-base font-semibold text-slate-900"
              >
                Confirm Material Issue
              </h2>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Material Request</dt>
                <dd className="font-mono font-medium text-slate-800">
                  {mr.name}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Company</dt>
                <dd className="font-medium text-slate-800">{mrCompany}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">From Warehouse</dt>
                <dd className="text-right font-semibold text-primary-700">
                  {fromWarehouse}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Issue Type</dt>
                <dd className="font-medium text-slate-800">{issueType}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Receiver</dt>
                <dd className="font-medium text-slate-800">{receiver}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-slate-500">
              Stock Entry will be created with source warehouse{" "}
              <span className="font-medium text-slate-700">{fromWarehouse}</span>
              . Warehouse company must match Material Request company (
              {mrCompany}).
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={issueMut.isPending}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={issueMut.isPending}
                onClick={() => issueMut.mutate()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {issueMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="h-4 w-4" />
                )}
                Confirm Issue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
