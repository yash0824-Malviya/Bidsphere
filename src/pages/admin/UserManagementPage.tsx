import { useLayoutEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Key,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  getUsers,
  getUserDetail,
  toggleUserEnabled,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  getRoles,
} from "../../api/admin";
import type { ErpUser } from "../../api/admin";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatDateTime } from "../../utils/format";

const PAGE_SIZE = 50;

const BIDSPHERE_ROLES = [
  "Administrator",
  "System Manager",
  "Procurement Manager",
  "Purchase Manager",
  "Purchase User",
  "Finance Manager",
  "Accounts Manager",
  "Accounts User",
  "Stock Manager",
  "Stock User",
  "Warehouse Manager",
  "Legal Reviewer",
];

type PanelMode = "closed" | "create" | "edit" | "view";

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  new_password: string;
  roles: string[];
  enabled: number;
}

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  department: "",
  designation: "",
  new_password: "",
  roles: [],
  enabled: 1,
};

export default function UserManagementPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Panel state
  const [panelMode, setPanelMode] = useState<PanelMode>("closed");
  const [panelUserId, setPanelUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; fullName: string } | null>(null);

  // Action menu
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => getUsers(page, PAGE_SIZE, search || undefined),
    staleTime: 30_000,
  });

  const { data: editUserDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["admin-user-detail", panelUserId],
    queryFn: () => getUserDetail(panelUserId!),
    enabled: !!panelUserId && (panelMode === "edit" || panelMode === "view"),
  });

  const { data: allRoles = [] } = useQuery({
    queryKey: ["admin-roles-list"],
    queryFn: getRoles,
    staleTime: 5 * 60_000,
  });
  const availableRoles = allRoles.length > 0
    ? allRoles.filter((r) => !r.disabled).map((r) => r.name)
    : BIDSPHERE_ROLES;

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-user-detail"] });
    qc.invalidateQueries({ queryKey: ["admin-kpis"] });
  }, [qc]);

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleUserEnabled(id, enabled),
    onSuccess: (ok, vars) => {
      if (ok) { toast.success(`User ${vars.enabled ? "enabled" : "disabled"}`); invalidateAll(); }
      else toast.error("Failed to update status");
    },
  });

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: (res) => {
      if (res.ok) { toast.success("User created successfully"); setPanelMode("closed"); invalidateAll(); }
      else toast.error(res.error ?? "Failed to create user");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateUser>[1] }) => updateUser(id, data),
    onSuccess: (res) => {
      if (res.ok) { toast.success("User updated successfully"); setPanelMode("closed"); invalidateAll(); }
      else toast.error(res.error ?? "Failed to update user");
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteUser,
    onSuccess: (res) => {
      if (res.ok) { toast.success("User deleted"); setDeleteTarget(null); invalidateAll(); }
      else toast.error(res.error ?? "Failed to delete user");
    },
  });

  const resetPwMut = useMutation({
    mutationFn: resetUserPassword,
    onSuccess: (res) => {
      if (res.ok) toast.success("Password reset email sent");
      else toast.error(res.error ?? "Failed to reset password");
    },
  });

  // When detail loads for edit mode, populate form
  useLayoutEffect(() => {
    if (editUserDetail && panelMode === "edit") {
      const parts = (editUserDetail.full_name ?? "").split(" ");
      setForm({
        first_name: parts[0] ?? "",
        last_name: parts.slice(1).join(" "),
        email: editUserDetail.email,
        phone: "",
        department: "",
        designation: "",
        new_password: "",
        roles: editUserDetail.roles,
        enabled: editUserDetail.enabled,
      });
    }
  }, [editUserDetail, panelMode]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setPanelUserId(null);
    setPanelMode("create");
  }
  function openEdit(userId: string) {
    setPanelUserId(userId);
    setPanelMode("edit");
    setActionMenu(null);
  }
  function openView(userId: string) {
    setPanelUserId(userId);
    setPanelMode("view");
  }
  function closePanel() { setPanelMode("closed"); setPanelUserId(null); }

  function handleSubmit() {
    if (panelMode === "create") {
      if (!form.email || !form.first_name || !form.new_password) {
        toast.error("Name, email, and password are required");
        return;
      }
      createMut.mutate({
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name || undefined,
        new_password: form.new_password,
        roles: form.roles.length > 0 ? form.roles : undefined,
      });
    } else if (panelMode === "edit" && panelUserId) {
      updateMut.mutate({
        id: panelUserId,
        data: {
          full_name: `${form.first_name} ${form.last_name}`.trim(),
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone || undefined,
          department: form.department || undefined,
          designation: form.designation || undefined,
          enabled: form.enabled,
          roles: form.roles,
        },
      });
    }
  }

  function toggleRole(role: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role)
        ? f.roles.filter((r) => r !== role)
        : [...f.roles, role],
    }));
  }

  const isSaving = createMut.isPending || updateMut.isPending;
  const panelOpen = panelMode !== "closed";

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">User Management</h1>
            <p className="text-[10px] text-neutral-500">Create, edit, and manage system users</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none"
        >
          <Plus className="h-3 w-3" /> Create User
        </button>
      </div>

      {/* Search */}
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (() => { setSearch(searchInput.trim()); setPage(0); })()}
            placeholder="Search users by name..."
            className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
        <button
          type="button"
          onClick={() => { setSearch(searchInput.trim()); setPage(0); }}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none"
        >
          Search
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-1">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
      ) : users.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white py-14 text-center shadow-sm">
          <Users className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">No users found</p>
          <p className="mt-0.5 text-xs text-neutral-500">Try adjusting your search criteria.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50">
              <tr className="border-b border-neutral-200">
                <th className="px-3 py-2 text-left font-semibold text-neutral-500">User</th>
                <th className="px-3 py-2 text-left font-semibold text-neutral-500">Email</th>
                <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-neutral-500">Created</th>
                <th className="px-3 py-2 text-right font-semibold text-neutral-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.name}
                  onClick={() => openView(u.name)}
                  className="border-b border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50/60 transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-600">
                        {(u.full_name || u.name).charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-neutral-900">{u.full_name || u.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{u.email}</td>
                  <td className="px-3 py-2">
                    {u.enabled ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                        <XCircle className="h-2.5 w-2.5" /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-500 tabular-nums">{formatDateTime(u.creation)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActionMenu(actionMenu === u.name ? null : u.name); }}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer bg-transparent border-none"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {actionMenu === u.name && (
                        <ActionMenu
                          user={u}
                          onEdit={() => openEdit(u.name)}
                          onToggle={() => { toggleMut.mutate({ id: u.name, enabled: !u.enabled }); setActionMenu(null); }}
                          onResetPw={() => { resetPwMut.mutate(u.name); setActionMenu(null); }}
                          onDelete={() => { setDeleteTarget({ name: u.name, fullName: u.full_name || u.name }); setActionMenu(null); }}
                          onClose={() => setActionMenu(null)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-1.5">
            <p className="text-[11px] text-neutral-500">Page {page + 1} &middot; {users.length} users</p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer bg-transparent border-none">
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <button type="button" disabled={users.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer bg-transparent border-none">
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Slide-over Panel ──────────────────────────────────────────────── */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" onClick={closePanel} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-2xl">
            {/* Panel header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
              <h2 className="text-sm font-bold text-neutral-900">
                {panelMode === "create" ? "Create User" : panelMode === "edit" ? "Edit User" : "User Details"}
              </h2>
              <button type="button" onClick={closePanel} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer bg-transparent border-none">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {panelMode === "view" ? (
                <ViewPanel
                  user={editUserDetail}
                  loading={loadingDetail}
                  onEdit={() => panelUserId && openEdit(panelUserId)}
                  onToggle={() => editUserDetail && toggleMut.mutate({ id: editUserDetail.name, enabled: !editUserDetail.enabled })}
                  onResetPw={() => panelUserId && resetPwMut.mutate(panelUserId)}
                  onDelete={() => editUserDetail && setDeleteTarget({ name: editUserDetail.name, fullName: editUserDetail.full_name })}
                />
              ) : (
                /* Create / Edit form */
                <div className="space-y-4">
                  {/* Basic Info */}
                  <FieldSection title="Basic Information">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="First Name *" value={form.first_name} onChange={(v) => setForm((f) => ({ ...f, first_name: v }))} />
                      <Field label="Last Name" value={form.last_name} onChange={(v) => setForm((f) => ({ ...f, last_name: v }))} />
                    </div>
                    <Field label="Email *" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" disabled={panelMode === "edit"} />
                    {panelMode === "create" && (
                      <Field label="Temporary Password *" value={form.new_password} onChange={(v) => setForm((f) => ({ ...f, new_password: v }))} type="password" />
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
                      <Field label="Department" value={form.department} onChange={(v) => setForm((f) => ({ ...f, department: v }))} />
                    </div>
                    <Field label="Designation" value={form.designation} onChange={(v) => setForm((f) => ({ ...f, designation: v }))} />
                  </FieldSection>

                  {/* Status */}
                  {panelMode === "edit" && (
                    <FieldSection title="Status">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={form.enabled === 1}
                            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked ? 1 : 0 }))}
                            className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 cursor-pointer"
                          />
                          <span className="font-medium text-neutral-700">Account Active</span>
                        </label>
                      </div>
                    </FieldSection>
                  )}

                  {/* Role Assignment */}
                  <FieldSection title="Role Assignment">
                    <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-neutral-200 p-2">
                      {availableRoles.map((role) => (
                        <label key={role} className="flex items-center gap-2 rounded px-2 py-1 cursor-pointer hover:bg-neutral-50 text-xs">
                          <input
                            type="checkbox"
                            checked={form.roles.includes(role)}
                            onChange={() => toggleRole(role)}
                            className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 cursor-pointer"
                          />
                          <span className="font-medium text-neutral-700">{role}</span>
                        </label>
                      ))}
                    </div>
                    {form.roles.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {form.roles.map((r) => (
                          <span key={r} className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-px text-[10px] font-semibold text-primary-700">
                            {r}
                            <button type="button" onClick={() => toggleRole(r)} className="text-primary-400 hover:text-primary-700 cursor-pointer bg-transparent border-none p-0">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </FieldSection>

                  {/* Submit */}
                  <div className="flex gap-2 pt-2 border-t border-neutral-200">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSaving}
                      className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50 cursor-pointer border-none"
                    >
                      {isSaving ? "Saving…" : panelMode === "create" ? "Create User" : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={closePanel}
                      className="rounded-md bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 cursor-pointer border-none"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" onClick={() => setDeleteTarget(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Delete User</h3>
                <p className="text-[11px] text-neutral-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="mb-4 text-xs text-neutral-700">
              Are you sure you want to permanently delete <strong>{deleteTarget.fullName}</strong> ({deleteTarget.name})? All associated data will be removed.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => deleteMut.mutate(deleteTarget.name)}
                disabled={deleteMut.isPending}
                className="flex-1 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer border-none"
              >
                {deleteMut.isPending ? "Deleting…" : "Delete User"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-md bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 cursor-pointer border-none"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function ActionMenu({
  user,
  onEdit,
  onToggle,
  onResetPw,
  onDelete,
  onClose,
}: {
  user: ErpUser;
  onEdit: () => void;
  onToggle: () => void;
  onResetPw: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl">
        <MenuBtn icon={Edit3} label="Edit" onClick={onEdit} />
        <MenuBtn icon={user.enabled ? UserMinus : UserPlus} label={user.enabled ? "Disable" : "Enable"} onClick={onToggle} />
        <MenuBtn icon={Key} label="Reset Password" onClick={onResetPw} />
        <div className="my-1 border-t border-neutral-100" />
        <MenuBtn icon={Trash2} label="Delete" onClick={onDelete} danger />
      </div>
    </>
  );
}

function MenuBtn({ icon: Icon, label, onClick, danger }: { icon: typeof Edit3; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition cursor-pointer bg-transparent border-none text-left ${
        danger ? "text-red-600 hover:bg-red-50" : "text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

function ViewPanel({
  user,
  loading,
  onEdit,
  onToggle,
  onResetPw,
  onDelete,
}: {
  user: ErpUser | null | undefined;
  loading: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onResetPw: () => void;
  onDelete: () => void;
}) {
  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-12 rounded" /><Skeleton className="h-8 rounded" /><Skeleton className="h-24 rounded" /></div>;
  }
  if (!user) return <p className="text-xs text-neutral-500">User not found</p>;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-base font-bold text-primary-700">
          {(user.full_name || user.name).charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-bold text-neutral-900">{user.full_name}</p>
          <p className="text-xs text-neutral-500">{user.email}</p>
        </div>
      </div>

      {/* Info */}
      <FieldSection title="Account Information">
        <InfoRow label="Status" value={user.enabled ? "Active" : "Disabled"} badge={user.enabled ? "emerald" : "red"} />
        <InfoRow label="User Type" value={user.user_type ?? "—"} />
        <InfoRow label="Created" value={formatDateTime(user.creation)} />
        <InfoRow label="Last Active" value={user.last_active ? formatDateTime(user.last_active) : "—"} />
      </FieldSection>

      {/* Roles */}
      <FieldSection title="Assigned Roles">
        {user.roles.length === 0 ? (
          <p className="text-[11px] text-neutral-500">No roles assigned</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-700">
                <Shield className="h-2.5 w-2.5 text-neutral-400" />{r}
              </span>
            ))}
          </div>
        )}
      </FieldSection>

      {/* Actions */}
      <div className="space-y-1.5 pt-2 border-t border-neutral-200">
        <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 cursor-pointer border-none">
          <Edit3 className="h-3 w-3" /> Edit User
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={onToggle} className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold cursor-pointer border-none ${user.enabled ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
            {user.enabled ? <UserMinus className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
            {user.enabled ? "Disable" : "Enable"}
          </button>
          <button type="button" onClick={onResetPw} className="flex items-center justify-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 cursor-pointer border-none">
            <Key className="h-3 w-3" /> Reset Password
          </button>
        </div>
        <button type="button" onClick={onDelete} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-neutral-100 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 cursor-pointer border-none">
          <Trash2 className="h-3 w-3" /> Delete User
        </button>
      </div>
    </div>
  );
}

function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-semibold text-neutral-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200 disabled:bg-neutral-50 disabled:text-neutral-500"
      />
    </div>
  );
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: "emerald" | "red" }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      {badge ? (
        <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${badge === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {value}
        </span>
      ) : (
        <span className="font-medium text-neutral-900">{value}</span>
      )}
    </div>
  );
}
