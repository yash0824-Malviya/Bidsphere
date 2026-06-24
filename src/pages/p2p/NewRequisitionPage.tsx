import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";

import { ENV_DEFAULTS } from "../../api/erpnext";
import { getCostCentres } from "../../api/purchasing";
import {
  createMaterialRequest,
  submitMaterialRequest,
} from "../../api/purchasing";
import type { MaterialRequestPayload } from "../../api/purchasing";
import ItemPicker from "../../components/ItemPicker";
import PageHeader from "../../components/PageHeader";
import { ErpNextDatePicker } from "../../components/ui";
import { formatCurrency, todayIso } from "../../utils/format";
import { assertERPNextDate } from "../../utils/erpNextDate";
import { generateId } from "../../utils/id";

interface DraftItem {
  id: string;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  rate: number;
}

function newDraftItem(): DraftItem {
  return {
    id: generateId(),
    item_code: "",
    item_name: "",
    qty: 1,
    uom: "",
    rate: 0,
  };
}

export default function NewRequisitionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [requiredBy, setRequiredBy] = useState(todayIso());
  const [costCenter, setCostCenter] = useState("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);

  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost-centers"],
    queryFn: () =>
      getCostCentres({
        filters: [
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ],
        fields: ["name", "cost_center_name"],
        limit_page_length: 200,
        order_by: "cost_center_name asc",
      }),
  });

  const total = items.reduce((sum, i) => sum + i.qty * i.rate, 0);

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }
  function addItem() {
    setItems((prev) => [...prev, newDraftItem()]);
  }

  function buildPayload(): MaterialRequestPayload {
    const scheduleIso = assertERPNextDate(requiredBy, "schedule_date");
    return {
      title: title.trim() || undefined,
      material_request_type: "Purchase",
      transaction_date: todayIso(),
      schedule_date: scheduleIso,
      cost_center: costCenter || undefined,
      company: ENV_DEFAULTS.company || undefined,
      remarks: title.trim() || undefined,
      items: items
        .filter((i) => i.item_code && i.qty > 0)
        .map((i) => ({
          item_code: i.item_code,
          item_name: i.item_name,
          qty: i.qty,
          uom: i.uom,
          rate: i.rate || undefined,
          amount: i.qty * i.rate || undefined,
          schedule_date: scheduleIso,
        })),
    };
  }

  function validate(): string | null {
    if (!title.trim()) return "Please add a title.";
    if (!requiredBy) return "Required-by date is mandatory.";
    const validItems = items.filter((i) => i.item_code && i.qty > 0);
    if (validItems.length === 0) return "Add at least one item.";
    return null;
  }

  const draftMutation = useMutation({
    mutationFn: (payload: MaterialRequestPayload) =>
      createMaterialRequest(payload),
    onSuccess: (mr) => {
      toast.success(`Draft saved as ${mr.name}`);
      queryClient.invalidateQueries({ queryKey: ["material-requests"] });
      navigate(`/p2p/requisitions/${mr.name}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: MaterialRequestPayload) => {
      const draft = await createMaterialRequest(payload);
      return submitMaterialRequest(draft.name);
    },
    onSuccess: (mr) => {
      toast.success(`${mr.name} submitted for approval`);
      queryClient.invalidateQueries({ queryKey: ["material-requests"] });
      navigate(`/p2p/requisitions/${mr.name}`);
    },
  });

  function handleSaveDraft() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const payload = buildPayload();
    // eslint-disable-next-line no-console
    console.log("Final API Payload", payload);
    draftMutation.mutate(payload);
  }
  function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const payload = buildPayload();
    // eslint-disable-next-line no-console
    console.log("Final API Payload", payload);
    submitMutation.mutate(payload);
  }

  const isSaving = draftMutation.isPending || submitMutation.isPending;

  return (
    <div>
      <Link
        to="/p2p/requisitions"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to material requests
      </Link>

      <PageHeader
        title="New Material Request"
        description="Capture an internal purchase request to begin the procurement workflow."
      />

      <div className="space-y-6">
        <div className="grid gap-4 card p-5 shadow-sm md:grid-cols-3">
          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lab consumables Q3"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </Field>

          <Field label="Required By" required>
            <ErpNextDatePicker value={requiredBy} onChange={setRequiredBy} required />
          </Field>

          <Field label="Cost Center">
            <select
              value={costCenter}
              onChange={(e) => setCostCenter(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <option value="">Select cost center…</option>
              {costCenters.map((cc) => (
                <option key={cc.name} value={cc.name}>
                  {cc.cost_center_name ?? cc.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="card">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
              <p className="text-xs text-neutral-500">
                Add at least one item with quantity and rate.
              </p>
            </div>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Row
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 w-[28%]">Item Code</th>
                  <th className="px-3 py-2 w-[26%]">Item Name</th>
                  <th className="px-3 py-2 w-[10%] text-right">Qty</th>
                  <th className="px-3 py-2 w-[10%]">UOM</th>
                  <th className="px-3 py-2 w-[14%] text-right">Est. Rate</th>
                  <th className="px-3 py-2 w-[10%] text-right">Amount</th>
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
                        placeholder="Item name"
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
                        placeholder="Nos"
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
                    <td className="px-3 py-2 align-top text-right text-sm font-medium tabular-nums text-neutral-900">
                      {formatCurrency(it.qty * it.rate)}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        disabled={items.length === 1}
                        className="text-neutral-400 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50">
                  <td colSpan={5} className="px-3 py-3 text-right text-sm font-medium text-neutral-700">
                    Estimated Total
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-neutral-900">
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
            onClick={() => navigate("/p2p/requisitions")}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            disabled={isSaving}
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
            Submit for Approval
          </button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, required, children }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-danger-500">*</span>}
      </label>
      {children}
    </div>
  );
}
