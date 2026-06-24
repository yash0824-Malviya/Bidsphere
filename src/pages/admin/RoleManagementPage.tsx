import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Key,
  Search,
  Shield,
  XCircle,
} from "lucide-react";

import { getRoles } from "../../api/admin";
import { APP_NAME } from "../../config/branding";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

const BIDSPHERE_ROLE_MAP: Record<string, { module: string; level: string }> = {
  Administrator: { module: "All Modules", level: "Full Access" },
  "System Manager": { module: "All Modules", level: "Full Access" },
  "Procurement Manager": { module: "Sourcing, P2P", level: "Create / Edit / Submit" },
  "Purchase Manager": { module: "Sourcing, P2P", level: "Create / Edit / Submit" },
  "Purchase User": { module: "Sourcing, P2P", level: "Read / Create" },
  "Finance Manager": { module: "Finance, Budget", level: "Approve / Submit" },
  "Accounts Manager": { module: "Finance", level: "Full Finance Access" },
  "Accounts User": { module: "Finance", level: "Read / Create" },
  "Stock Manager": { module: "Warehouse, Inventory", level: "Full Warehouse Access" },
  "Stock User": { module: "Warehouse", level: "Read / Create" },
  "Warehouse Manager": { module: "Warehouse, Inventory", level: "Full Warehouse Access" },
  "Legal Reviewer": { module: "Legal Reviews", level: "Review / Approve" },
};

export default function RoleManagementPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [search, setSearch] = useState("");

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: getRoles,
    staleTime: 5 * 60_000,
  });

  const filtered = search
    ? roles.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : roles;

  const mapped = filtered.filter((r) => BIDSPHERE_ROLE_MAP[r.name]);
  const others = filtered.filter((r) => !BIDSPHERE_ROLE_MAP[r.name]);

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
          <Shield className="h-4 w-4 text-violet-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Role Management</h1>
          <p className="text-[11px] text-neutral-500">View roles and module permissions</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3 relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roles..."
          className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
        />
      </div>

      {isLoading ? (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
        </div>
      ) : (
        <>
          <h2 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">{APP_NAME} Role Mappings</h2>
          <div className="mb-4 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500">Module Access</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500">Permission Level</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {mapped.map((role) => {
                  const info = BIDSPHERE_ROLE_MAP[role.name];
                  return (
                    <tr key={role.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Key className="h-3 w-3 text-violet-500" />
                          <span className="font-medium text-neutral-900">{role.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-neutral-600">{info?.module ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-primary-50 px-1.5 py-px text-[10px] font-semibold text-primary-700">
                          {info?.level ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {!role.disabled ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                            <XCircle className="h-2.5 w-2.5" /> Disabled
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Other ERPNext Roles */}
          {others.length > 0 && (
            <>
              <h2 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Other ERPNext Roles ({others.length})</h2>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50">
                    <tr className="border-b border-neutral-200">
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Role</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((role) => (
                      <tr key={role.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
                        <td className="px-3 py-2 font-medium text-neutral-700">{role.name}</td>
                        <td className="px-3 py-2">
                          {!role.disabled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-400">
                              <XCircle className="h-2.5 w-2.5" /> Disabled
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
