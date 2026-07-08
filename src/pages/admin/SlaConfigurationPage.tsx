import { useLayoutEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Plus, ShieldAlert, Timer, Trash2 } from "lucide-react";

import {
  createSlaConfiguration,
  deleteSlaConfiguration,
  listErpRoles,
  listSlaConfigurations,
  setSlaConfigurationEnabled,
  updateSlaConfiguration,
  type SlaConfiguration,
} from "../../api/sla";
import {
  SLA_PRIORITIES,
  SLA_TIME_UNITS,
  SLA_WORKFLOWS,
} from "../../config/slaWorkflows";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

type Draft = Omit<SlaConfiguration, "name">;

function emptyDraft(): Draft {
  return {
    sla_name: "",
    workflow: "Warehouse Review",
    stage: "",
    role: "",
    priority: "All",
    duration: 4,
    time_unit: "Hours",
    reminder_before: 30,
    reminder_unit: "Minutes",
    escalation_role: "",
    enabled: 1,
  };
}

export default function SlaConfigurationPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);

  const configsQuery = useQuery({
    queryKey: ["sla-configurations"],
    queryFn: listSlaConfigurations,
    staleTime: 60_000,
    retry: false,
  });

  const rolesQuery = useQuery({
    queryKey: ["erp-roles"],
    queryFn: listErpRoles,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const roleOptions = rolesQuery.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sla-configurations"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: Draft) => {
      if (editing) return updateSlaConfiguration(editing, payload);
      return createSlaConfiguration(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "SLA rule updated." : "SLA rule created.");
      setDraft(null);
      setEditing(null);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save SLA rule."),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setSlaConfigurationEnabled(name, enabled),
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update status."),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteSlaConfiguration(name),
    onSuccess: () => {
      toast.success("SLA rule deleted.");
      setDeleteName(null);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not delete SLA rule."),
  });

  const configs = configsQuery.data ?? [];
  const activeCount = useMemo(
    () => configs.filter((c) => (c.enabled ?? 1) === 1).length,
    [configs]
  );

  const startCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
  };
  const startEdit = (c: SlaConfiguration) => {
    setEditing(c.name);
    setDraft({
      sla_name: c.sla_name,
      workflow: c.workflow,
      stage: c.stage ?? "",
      role: c.role ?? "",
      priority: c.priority ?? "All",
      duration: c.duration ?? 0,
      time_unit: c.time_unit ?? "Hours",
      reminder_before: c.reminder_before ?? 0,
      reminder_unit: c.reminder_unit ?? "Minutes",
      escalation_role: c.escalation_role ?? "",
      enabled: c.enabled ?? 1,
    });
  };

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const canSave =
    !!draft && draft.sla_name.trim().length > 0 && Number(draft.duration) > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Timer className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-900">SLA Configuration</p>
            <p className="text-xs text-neutral-500">
              {configs.length} rules · {activeCount} active — durations drive
              every workflow timer.
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={startCreate}>
          <Plus className="h-4 w-4" />
          New SLA Rule
        </button>
      </div>

      {draft && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/30 p-4">
          <p className="mb-3 text-sm font-bold text-neutral-800">
            {editing ? "Edit SLA Rule" : "New SLA Rule"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="SLA Name" required>
              <input
                className="input-field"
                value={draft.sla_name}
                onChange={(e) => update("sla_name", e.target.value)}
                placeholder="e.g. Warehouse Review"
              />
            </Field>
            <Field label="Workflow" required>
              <select
                className="input-field"
                value={String(draft.workflow)}
                onChange={(e) => update("workflow", e.target.value)}
              >
                {SLA_WORKFLOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stage (optional)">
              <input
                className="input-field"
                value={draft.stage ?? ""}
                onChange={(e) => update("stage", e.target.value)}
                placeholder="Defaults to workflow"
              />
            </Field>
            <Field label="Responsible Role">
              <select
                className="input-field"
                value={draft.role ?? ""}
                onChange={(e) => update("role", e.target.value)}
              >
                <option value="">
                  {rolesQuery.isLoading ? "Loading roles…" : "Any"}
                </option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {draft.role && !roleOptions.includes(draft.role) ? (
                  <option value={draft.role}>{draft.role}</option>
                ) : null}
              </select>
            </Field>
            <Field label="Priority">
              <select
                className="input-field"
                value={String(draft.priority ?? "All")}
                onChange={(e) => update("priority", e.target.value)}
              >
                {SLA_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Duration" required>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  className="input-field w-24"
                  value={draft.duration ?? 0}
                  onChange={(e) => update("duration", Number(e.target.value))}
                />
                <select
                  className="input-field flex-1"
                  value={String(draft.time_unit)}
                  onChange={(e) => update("time_unit", e.target.value)}
                >
                  {SLA_TIME_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Reminder Before Expiry">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="1"
                  className="input-field w-24"
                  value={draft.reminder_before ?? 0}
                  onChange={(e) =>
                    update("reminder_before", Number(e.target.value))
                  }
                />
                <select
                  className="input-field flex-1"
                  value={String(draft.reminder_unit ?? "Minutes")}
                  onChange={(e) => update("reminder_unit", e.target.value)}
                >
                  {SLA_TIME_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Escalation Role">
              <select
                className="input-field"
                value={draft.escalation_role ?? ""}
                onChange={(e) => update("escalation_role", e.target.value)}
              >
                <option value="">None</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {draft.escalation_role &&
                !roleOptions.includes(draft.escalation_role) ? (
                  <option value={draft.escalation_role}>
                    {draft.escalation_role}
                  </option>
                ) : null}
              </select>
            </Field>
            <Field label="Status">
              <label className="flex items-center gap-2 pt-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={(draft.enabled ?? 1) === 1}
                  onChange={(e) => update("enabled", e.target.checked ? 1 : 0)}
                  className="h-4 w-4 rounded border-neutral-300 text-primary-600"
                />
                Active
              </label>
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => draft && saveMutation.mutate(draft)}
            >
              {saveMutation.isPending
                ? "Saving…"
                : editing
                  ? "Update Rule"
                  : "Create Rule"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(null);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>SLA Name</th>
              <th>Workflow</th>
              <th>Role</th>
              <th>Priority</th>
              <th className="text-right">Duration</th>
              <th>Reminder</th>
              <th>Escalation</th>
              <th className="text-center">Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configsQuery.isLoading ? (
              <tr>
                <td colSpan={9} className="p-4">
                  <Skeleton className="h-24 w-full" />
                </td>
              </tr>
            ) : configs.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-neutral-500">
                  <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
                  No SLA rules yet. Create one to start tracking workflow
                  deadlines.
                </td>
              </tr>
            ) : (
              configs.map((c) => {
                const active = (c.enabled ?? 1) === 1;
                return (
                  <tr key={c.name}>
                    <td className="font-medium text-neutral-800">{c.sla_name}</td>
                    <td className="text-neutral-700">
                      {c.workflow}
                      {c.stage ? (
                        <span className="block text-[11px] text-neutral-400">
                          {c.stage}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-neutral-600">{c.role || "Any"}</td>
                    <td className="text-neutral-600">{c.priority || "All"}</td>
                    <td className="text-right tabular-nums text-neutral-700">
                      {c.duration} {c.time_unit}
                    </td>
                    <td className="text-neutral-600">
                      {(c.reminder_before ?? 0) > 0
                        ? `${c.reminder_before} ${c.reminder_unit ?? "Minutes"} before`
                        : "—"}
                    </td>
                    <td className="text-neutral-600">{c.escalation_role || "—"}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() =>
                          toggleMutation.mutate({ name: c.name, enabled: !active })
                        }
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                          active
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-neutral-100 text-neutral-500 ring-neutral-200"
                        }`}
                      >
                        {active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Edit"
                          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-primary"
                          onClick={() => startEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          className="rounded p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                          onClick={() => setDeleteName(c.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteName}
        onClose={() => setDeleteName(null)}
        onConfirm={() => {
          if (deleteName) deleteMutation.mutate(deleteName);
        }}
        title="Delete SLA rule?"
        description="Existing timers keep running; only the rule is removed so no new timers use it."
        confirmLabel="Delete"
        tone="danger"
        isLoading={deleteMutation.isPending}
      />
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
    <label className="text-sm">
      <span className="mb-1 block font-medium text-neutral-600">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
