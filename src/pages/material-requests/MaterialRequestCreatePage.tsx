import { useEffect, useMemo, useRef, useState } from "react";

import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import toast from "react-hot-toast";

import {
  ArrowLeft,
  Briefcase,
  ClipboardList,
  Factory,
  Loader2,
  Package,
  Plus,
  StickyNote,
} from "lucide-react";

import { fetchUserDepartment } from "../../api/auth";
import { ENV_DEFAULTS } from "../../api/erpnext";

import {
  createMaterialRequestWorkflow,
  fetchMaterialRequestWorkflow,
  submitMaterialRequestWorkflow,
} from "../../api/materialRequestWorkflow";
import { updateMaterialRequest } from "../../api/purchasing";
import {
  MR_PROCUREMENT_TYPE_FIELD,
  MR_WORKFLOW_FIELD,
} from "../../types/materialRequestWorkflow";
import { defaultProcurementTypeForDepartment } from "../../config/procurementType";

import type {
  MaterialRequestPriority,
  MaterialRequestProcurementType,
} from "../../types/materialRequestWorkflow";

import MaterialRequestItemLineRow, {
  type MaterialRequestDraftLine,
} from "../../components/material-requests/MaterialRequestItemLineRow";

import PageHeader from "../../components/PageHeader";

import { ErpNextDatePicker } from "../../components/ui";

import { useAuthStore } from "../../store/authStore";

import { canCreateMaterialRequest } from "../../config/materialRequestPermissions";

import { todayIso } from "../../utils/format";

import { assertERPNextDate } from "../../utils/erpNextDate";

import { generateId } from "../../utils/id";

function newDraftItem(requiredBy: string): MaterialRequestDraftLine {
  return {
    id: generateId(),

    item_group: "",

    item_code: "",

    item_name: "",

    description: "",

    qty: 1,

    uom: "Nos",

    schedule_date: requiredBy,

    remarks: "",
  };
}

function resolveDepartmentValue(value?: string | null): string {
  return value?.trim() || "Production";
}

function validateMaterialRequestForm(
  purpose: string,

  department: string,

  items: MaterialRequestDraftLine[],
): string | null {
  if (!purpose) {
    return "Purpose is required.";
  }

  if (!department.trim()) {
    return "Department is required.";
  }

  const activeLines = items.filter(
    (line) => line.item_code || line.qty > 0 || line.description,
  );

  if (activeLines.length === 0) {
    return "Add at least one item line.";
  }

  for (const line of activeLines) {
    if (!line.item_group) {
      return "Select an item group for each line.";
    }

    if (!line.item_code) {
      return "Select an item for each line.";
    }

    if (!(line.qty > 0)) {
      return "Quantity must be greater than zero for each item.";
    }
  }

  const codes = activeLines.map((line) => line.item_code);

  if (new Set(codes).size !== codes.length) {
    return "Remove duplicate items — each item may only appear once.";
  }

  return null;
}

export default function MaterialRequestCreatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  // Department users must never see warehouse inventory. Stock columns (and the
  // underlying stock fetch) are only shown to non-department creators (admin).
  const showStock = user?.role !== "department";

  const [searchParams] = useSearchParams();
  const editName = searchParams.get("edit");
  const isEditMode = Boolean(editName);

  const [requestDate, setRequestDate] = useState(todayIso());

  const [requiredDate, setRequiredDate] = useState(todayIso());

  const [department, setDepartment] = useState("Production");
  const [departmentTouched, setDepartmentTouched] = useState(false);

  const [procurementType, setProcurementType] =
    useState<MaterialRequestProcurementType>("Direct");
  const [procurementTypeTouched, setProcurementTypeTouched] = useState(false);

  const [priority, setPriority] = useState<MaterialRequestPriority>("Medium");

  const [purpose, setPurpose] = useState("Purchase");

  const [notes, setNotes] = useState("");

  const [showErrors, setShowErrors] = useState(false);

  const [hydrated, setHydrated] = useState(false);

  // Synchronous re-entrancy lock. `saveMutation.isPending` only flips after a
  // re-render, so two fast clicks (or a click + Enter) can both call
  // `.mutate()` before the button is disabled — creating duplicate Material
  // Requests in ERPNext. This ref blocks the second call immediately.
  const submittingRef = useRef(false);

  const [items, setItems] = useState<MaterialRequestDraftLine[]>([
    newDraftItem(todayIso()),
  ]);

  // Edit mode — load the existing draft and prefill the form once.
  const editQuery = useQuery({
    queryKey: ["material-request-workflow", editName],
    queryFn: () => fetchMaterialRequestWorkflow(editName as string),
    enabled: isEditMode,
  });

  // One-time hydration of the form from the loaded draft. This is a legitimate
  // "sync local form state from fetched server data on first load" effect; the
  // `hydrated` guard limits it to a single extra render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const doc = editQuery.data;
    if (!doc || hydrated) return;

    if ((doc.docstatus ?? 0) !== 0) {
      toast.error("Only draft Material Requests can be edited.");
      navigate(`/material-requests/${encodeURIComponent(doc.name)}`, {
        replace: true,
      });
      return;
    }

    setRequestDate(doc.transaction_date || todayIso());
    setRequiredDate(doc.schedule_date || todayIso());
    if (doc.custom_department) {
      setDepartment(doc.custom_department);
      setDepartmentTouched(true);
    }
    if (doc[MR_PROCUREMENT_TYPE_FIELD]) {
      setProcurementType(
        doc[MR_PROCUREMENT_TYPE_FIELD] === "Indirect" ? "Indirect" : "Direct",
      );
      setProcurementTypeTouched(true);
    }
    if (doc.custom_priority) setPriority(doc.custom_priority);
    setPurpose(doc.custom_purpose || "Purchase");
    // `remarks` carries the free-text notes when they differ from the intent
    // stored in `custom_purpose`; otherwise there are no separate notes.
    setNotes(
      doc.remarks && doc.remarks !== doc.custom_purpose ? doc.remarks : "",
    );

    const lines: MaterialRequestDraftLine[] = (doc.items ?? []).map((it) => ({
      id: generateId(),
      item_group: (it as { item_group?: string }).item_group ?? "",
      item_code: it.item_code ?? "",
      item_name: it.item_name ?? "",
      description: it.description ?? "",
      qty: Number(it.qty) || 1,
      uom: it.uom || "Nos",
      schedule_date:
        it.schedule_date || doc.schedule_date || todayIso(),
      remarks: "",
    }));
    setItems(
      lines.length > 0
        ? lines
        : [newDraftItem(doc.schedule_date || todayIso())],
    );
    setHydrated(true);
  }, [editQuery.data, hydrated, navigate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const userDepartmentQuery = useQuery({
    queryKey: ["user-department", user?.name],
    queryFn: () => fetchUserDepartment(user!.name),
    enabled: !!user?.name,
    staleTime: 5 * 60_000,
  });

  const fallbackDepartment = resolveDepartmentValue(
    userDepartmentQuery.data ?? user?.department,
  );
  const resolvedDepartment = resolveDepartmentValue(
    departmentTouched ? department : fallbackDepartment,
  );

  // Procurement type defaults from the department (Production → Direct, support
  // departments → Indirect) until the user explicitly overrides it.
  const resolvedProcurementType: MaterialRequestProcurementType =
    procurementTypeTouched
      ? procurementType
      : defaultProcurementTypeForDepartment(resolvedDepartment);

  const usedItemCodes = useMemo(() => {
    const set = new Set<string>();

    for (const line of items) {
      if (line.item_code) set.add(line.item_code);
    }

    return set;
  }, [items]);

  const saveMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const validationError = validateMaterialRequestForm(
        purpose,
        resolvedDepartment,
        items,
      );

      if (validationError) throw new Error(validationError);

      const scheduleIso = assertERPNextDate(requiredDate, "schedule_date");

      const payloadItems = items

        .filter((line) => line.item_code && line.qty > 0)

        .map((line) => ({
          item_code: line.item_code,

          item_name: line.item_name,

          description: line.description,

          qty: line.qty,

          uom: line.uom || "Nos",

          schedule_date: line.schedule_date
            ? assertERPNextDate(line.schedule_date, "schedule_date")
            : scheduleIso,
        }));

      const transactionIso = assertERPNextDate(
        requestDate,
        "transaction_date",
      );

      // Edit mode — update the existing draft in place (never create a new one).
      if (editName) {
        await updateMaterialRequest(editName, {
          transaction_date: transactionIso,
          schedule_date: scheduleIso,
          custom_department: resolvedDepartment,
          [MR_PROCUREMENT_TYPE_FIELD]: resolvedProcurementType,
          custom_priority: priority,
          custom_purpose: purpose,
          remarks: notes.trim() || purpose,
          [MR_WORKFLOW_FIELD]: "Draft",
          items: payloadItems.map((it) => ({
            doctype: "Material Request Item",
            ...it,
          })),
        } as never);

        if (submit) {
          return submitMaterialRequestWorkflow(editName);
        }

        return fetchMaterialRequestWorkflow(editName);
      }

      const created = await createMaterialRequestWorkflow({
        company: ENV_DEFAULTS.company,

        transaction_date: transactionIso,

        schedule_date: scheduleIso,

        department: resolvedDepartment,

        procurement_type: resolvedProcurementType,

        priority,

        purpose: purpose,

        requested_by: user?.full_name ?? user?.email ?? user?.name,

        remarks: notes.trim() || purpose,

        items: payloadItems,
      });

      if (submit) {
        return submitMaterialRequestWorkflow(created.name);
      }

      return created;
    },

    onSuccess: (doc, submit) => {
      queryClient.invalidateQueries({
        queryKey: ["material-requests-workflow"],
      });
      queryClient.invalidateQueries({
        queryKey: ["mr-dashboard-counts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["mr-dashboard-recent"],
      });
      queryClient.invalidateQueries({
        queryKey: ["mr-dashboard-rows"],
      });
      queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
      if (editName) {
        queryClient.invalidateQueries({
          queryKey: ["material-request-workflow", editName],
        });
      }

      toast.success(
        submit
          ? "Material Request submitted"
          : isEditMode
            ? "Material Request updated"
            : "Draft saved",
      );

      navigate(`/material-requests/${encodeURIComponent(doc.name)}`);
    },

    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },

    // Release the re-entrancy lock once the request fully settles (success or
    // error) so the user can retry after a genuine failure.
    onSettled: () => {
      submittingRef.current = false;
    },
  });

  function updateItem(id: string, patch: Partial<MaterialRequestDraftLine>) {
    setItems((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  // Switching Procurement Type reloads the correct Item Group category, so every
  // selected Item Group / Item (and its auto-filled Description / UOM) is cleared.
  function handleProcurementTypeChange(next: MaterialRequestProcurementType) {
    setProcurementTypeTouched(true);
    setProcurementType(next);
    setItems([newDraftItem(requiredDate)]);
  }

  function handleSave(submit: boolean) {
    // GUARD: block re-entry immediately — before React re-renders and disables
    // the buttons — so a double-click can never create duplicate MRs.
    if (submittingRef.current || saveMutation.isPending) {
      return;
    }

    setShowErrors(true);

    const validationError = validateMaterialRequestForm(
      purpose,
      resolvedDepartment,
      items,
    );

    if (validationError) {
      toast.error(validationError);

      return;
    }

    submittingRef.current = true;
    saveMutation.mutate(submit);
  }

  const busy = saveMutation.isPending;

  const purposeError = showErrors && !purpose;

  const shouldScrollLineItems = items.length > 6;

  if (!canCreateMaterialRequest(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isEditMode && editQuery.isLoading && !hydrated) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (isEditMode && editQuery.isError) {
    return (
      <div className="py-16 text-center text-neutral-500">
        Material Request not found.
        <Link
          to="/material-requests/list"
          className="mt-2 block text-primary-600"
        >
          Back to Material Requests
        </Link>
      </div>
    );
  }

  const backTo =
    isEditMode && editName
      ? `/material-requests/${encodeURIComponent(editName)}`
      : "/dashboard";

  return (
    <div>
      <Link
        to={backTo}

        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600 no-underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <PageHeader
        title={isEditMode ? "Edit Material Request" : "New Material Request"}

        description={
          isEditMode
            ? "Update this draft Material Request before submitting it for warehouse review."
            : "Request materials for warehouse review. The warehouse team will assign the issuing location."
        }
      />

      <div className="space-y-4">
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <ClipboardList className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Request Details
              </h3>
              <p className="text-xs text-neutral-500">
                Tell the warehouse what you need and when it&apos;s required on
                the production floor.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Request Date" required>
              <ErpNextDatePicker
                value={requestDate}

                onChange={setRequestDate}

                disabled={busy}
              />
            </Field>

            <Field label="Required Date" required>
              <ErpNextDatePicker
                value={requiredDate}

                onChange={setRequiredDate}

                disabled={busy}
              />
            </Field>

            <Field label="Requested By">
              <input
                readOnly

                value={user?.full_name ?? user?.email ?? "—"}

                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
              />
            </Field>

            <Field label="Department" required>
              <input
                value={departmentTouched ? department : fallbackDepartment}

                onChange={(e) => {
                  setDepartmentTouched(true);
                  setDepartment(e.target.value);
                }}

                onBlur={() => {
                  if (!department.trim()) {
                    setDepartment("");
                    setDepartmentTouched(false);
                  }
                }}

                disabled={busy}

                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
              />
            </Field>

            <Field label={t("procurementType.label")} required>
              <ProcurementTypePicker
                value={resolvedProcurementType}
                onChange={handleProcurementTypeChange}
                disabled={busy}
                t={t}
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                {resolvedProcurementType === "Direct"
                  ? t("procurementType.helpDirect")
                  : t("procurementType.helpIndirect")}
              </p>
            </Field>

            <Field label="Priority" required>
              <PriorityPicker
                value={priority}
                onChange={setPriority}
                disabled={busy}
              />
            </Field>

            <Field label="Status">
              <input
                readOnly

                value="Draft"

                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
              />
            </Field>

            <Field label="Purpose" required>
              <select
                value={purpose}

                onChange={(e) => setPurpose(e.target.value)}

                disabled={busy}

                aria-invalid={purposeError}

                className={`w-full rounded-lg border px-3 py-2 text-sm ${
                  purposeError ? "border-danger-400" : "border-neutral-200"
                }`}
              >
                {(
                  [
                    "Purchase",
                    "Material Transfer",
                    "Material Issue",
                    "Manufacture",
                    "Subcontracting",
                    "Customer Provided",
                  ] as const
                ).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 px-5 py-3">
            <div className="flex items-start gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <Package className="h-4 w-4" />
              </span>

              <div>
                <h3 className="text-sm font-bold text-neutral-900">
                  Items Required
                </h3>

                <p className="text-xs text-neutral-500">
                  {showStock
                    ? "Pick an item group, then the item — Description, UOM and stock are filled automatically from live ERPNext data."
                    : "Pick an item group, then the item — Description and UOM are filled automatically from live ERPNext data."}
                </p>
              </div>
            </div>

            <button
              type="button"

              onClick={() =>
                setItems((prev) => [...prev, newDraftItem(requiredDate)])
              }

              disabled={busy}

              className="inline-flex items-center gap-1 self-start rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add Line
            </button>
          </div>

          <div
            className={
              shouldScrollLineItems
                ? "max-h-[392px] overflow-x-auto overflow-y-auto"
                : "overflow-x-auto overflow-y-visible"
            }
          >
            <table
              className={`${showStock ? "min-w-[1470px]" : "min-w-[1130px]"} w-full table-fixed text-sm`}
            >
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 300 }} />
                <col style={{ width: 360 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                {showStock && (
                  <>
                    <col style={{ width: 110 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                  </>
                )}
                <col style={{ width: 50 }} />
              </colgroup>

              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-2 py-3 text-center`}
                  >
                    #
                  </th>

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3`}
                  >
                    Item Group <span className="text-danger-500">*</span>
                  </th>

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3`}
                  >
                    Item <span className="text-danger-500">*</span>
                  </th>

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3`}
                  >
                    Description
                  </th>

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3 text-center`}
                  >
                    UOM
                  </th>

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3`}
                  >
                    Qty <span className="text-danger-500">*</span>
                  </th>

                  {showStock && (
                    <>
                      <th
                        className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3 text-right`}
                      >
                        Current Stock
                      </th>

                      <th
                        className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3 text-right`}
                      >
                        Available Stock
                      </th>

                      <th
                        className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-3 py-3`}
                      >
                        Stock Status
                      </th>
                    </>
                  )}

                  <th
                    className={`${shouldScrollLineItems ? "sticky top-0 z-10 bg-neutral-50/95 backdrop-blur" : ""} px-2 py-3`}
                  />
                </tr>
              </thead>

              <tbody className="bg-white">
                {items.map((item, idx) => (
                  <MaterialRequestItemLineRow
                    key={item.id}

                    row={item}

                    rowNumber={idx + 1}

                    showErrors={showErrors}

                    showStock={showStock}

                    procurementType={resolvedProcurementType}

                    canRemove={items.length > 1}

                    usedItemCodes={
                      new Set(
                        [...usedItemCodes].filter((c) => c !== item.item_code),
                      )
                    }

                    onChange={(patch) => updateItem(item.id, patch)}

                    onRemove={() =>
                      setItems((prev) => prev.filter((x) => x.id !== item.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <StickyNote className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Additional Notes
              </h3>
              <p className="text-xs text-neutral-500">
                Optional — special instructions, urgency context, or acceptable
                alternatives for the warehouse team.
              </p>
            </div>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="e.g. Needed for the Line 2 engine assembly run; equivalent grade acceptable if exact item is out of stock."
            className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none disabled:opacity-50"
          />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"

            disabled={busy}

            onClick={() => handleSave(false)}

            style={{ pointerEvents: busy ? "none" : "auto" }}

            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEditMode ? "Save Changes" : "Save Draft"}
          </button>

          <button
            type="button"

            disabled={busy}

            onClick={() => handleSave(true)}

            style={{ pointerEvents: busy ? "none" : "auto" }}

            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting — please wait…
              </>
            ) : isEditMode ? (
              "Save & Submit for Review"
            ) : resolvedProcurementType === "Indirect" ? (
              "Submit for Admin Approval"
            ) : (
              "Submit for Warehouse Review"
            )}
          </button>

          <span className="text-xs text-neutral-400">
            <span className="text-red-500">*</span> Required fields
          </span>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_META: Record<
  MaterialRequestPriority,
  { active: string; idle: string }
> = {
  Low: {
    active: "border-emerald-500 bg-emerald-50 text-emerald-700",
    idle: "border-neutral-200 bg-white text-neutral-500 hover:border-emerald-200",
  },
  Medium: {
    active: "border-amber-500 bg-amber-50 text-amber-700",
    idle: "border-neutral-200 bg-white text-neutral-500 hover:border-amber-200",
  },
  High: {
    active: "border-orange-500 bg-orange-50 text-orange-700",
    idle: "border-neutral-200 bg-white text-neutral-500 hover:border-orange-200",
  },
  Urgent: {
    active: "border-red-500 bg-red-50 text-red-700",
    idle: "border-neutral-200 bg-white text-neutral-500 hover:border-red-200",
  },
};

function ProcurementTypePicker({
  value,
  onChange,
  disabled,
  t,
}: {
  value: MaterialRequestProcurementType;
  onChange: (next: MaterialRequestProcurementType) => void;
  disabled?: boolean;
  t: (key: string) => string;
}) {
  const options: Array<{
    key: MaterialRequestProcurementType;
    label: string;
    Icon: typeof Factory;
    active: string;
  }> = [
    {
      key: "Direct",
      label: t("procurementType.direct"),
      Icon: Factory,
      active: "border-blue-500 bg-blue-50 text-blue-700",
    },
    {
      key: "Indirect",
      label: t("procurementType.indirect"),
      Icon: Briefcase,
      active: "border-orange-500 bg-orange-50 text-orange-700",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => {
        const active = value === opt.key;
        const { Icon } = opt;
        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? opt.active
                : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PriorityPicker({
  value,
  onChange,
  disabled,
}: {
  value: MaterialRequestPriority;
  onChange: (next: MaterialRequestPriority) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(["Low", "Medium", "High", "Urgent"] as const).map((p) => {
        const meta = PRIORITY_META[p];
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(p)}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? meta.active : meta.idle
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,

  required,

  children,
}: {
  label: string;

  required?: boolean;

  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-neutral-600">
        {label}

        {required && <span className="text-red-500"> *</span>}
      </label>

      {children}
    </div>
  );
}
