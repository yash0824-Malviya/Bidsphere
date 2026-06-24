import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  FileText,
  Globe,
  Mail,
  Pencil,
  Phone,
  Receipt,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

import { apiGet } from "../../api/erpnext";
import { getPurchaseInvoices } from "../../api/accounts";
import { getPurchaseOrders } from "../../api/purchasing";
import { getSupplier } from "../../api/supplier";
import EditSupplierModal from "../../components/EditSupplierModal";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import Tabs, { useTabParam } from "../../components/Tabs";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  isOverdue,
} from "../../utils/format";

type SupplierTab =
  | "overview"
  | "purchase-orders"
  | "invoices"
  | "contacts"
  | "documents";

interface ContactRow {
  name: string;
  first_name?: string;
  last_name?: string;
  email_id?: string;
  mobile_no?: string;
  is_primary_contact?: 0 | 1;
}

interface FileRow {
  name: string;
  file_name?: string;
  file_url?: string;
  file_size?: number;
  is_private?: 0 | 1;
  creation?: string;
}

interface AddressRow {
  name: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  email_id?: string;
  phone?: string;
  is_primary_address?: 0 | 1;
}

function decodeSupplierName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function displayValue(value?: string | null): string {
  if (!value || value.trim() === "" || value === "—") return "Not Added";
  return value;
}

function isProfileIncomplete(
  supplier: import("../../types/erpnext").Supplier,
  address?: AddressRow
): boolean {
  const checks = [
    supplier.email_id,
    supplier.mobile_no,
    supplier.website,
    supplier.tax_id,
    supplier.payment_terms,
    supplier.default_currency,
    address?.address_line1 ?? supplier.country,
  ];
  return checks.filter((v) => v && String(v).trim()).length < 4;
}

export default function SupplierDetailPage() {
  const { name: rawName = "" } = useParams();
  const name = decodeSupplierName(rawName);
  const queryClient = useQueryClient();
  const [tab, setTab] = useTabParam<SupplierTab>("overview");
  const [editOpen, setEditOpen] = useState(false);

  const { data: supplier, isLoading, isError } = useQuery({
    queryKey: ["supplier", name],
    queryFn: () => getSupplier(name),
    enabled: !!name,
  });

  const { data: pos = [], isLoading: posLoading } = useQuery({
    queryKey: ["supplier-pos", name],
    queryFn: () =>
      getPurchaseOrders({
        filters: [["supplier", "=", name]],
        fields: [
          "name",
          "transaction_date",
          "status",
          "grand_total",
          "currency",
          "per_received",
          "per_billed",
        ],
        order_by: "transaction_date desc",
        limit_page_length: 100,
      }),
    enabled: !!name && tab === "purchase-orders",
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["supplier-invoices", name],
    queryFn: () =>
      getPurchaseInvoices({
        filters: [["supplier", "=", name]],
        fields: [
          "name",
          "posting_date",
          "due_date",
          "status",
          "grand_total",
          "outstanding_amount",
          "currency",
        ],
        order_by: "posting_date desc",
        limit_page_length: 100,
      }),
    enabled: !!name && tab === "invoices",
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<ContactRow[]>({
    queryKey: ["supplier-contacts", name],
    queryFn: () =>
      apiGet<ContactRow[]>("/api/resource/Contact", {
        params: {
          filters: JSON.stringify([
            ["Dynamic Link", "link_doctype", "=", "Supplier"],
            ["Dynamic Link", "link_name", "=", name],
          ]),
          fields: JSON.stringify([
            "name",
            "first_name",
            "last_name",
            "email_id",
            "mobile_no",
            "is_primary_contact",
          ]),
          limit_page_length: 50,
        },
      }),
    enabled: !!name && tab === "contacts",
  });

  const { data: addresses = [] } = useQuery<AddressRow[]>({
    queryKey: ["supplier-addresses", name],
    queryFn: () =>
      apiGet<AddressRow[]>("/api/resource/Address", {
        params: {
          filters: JSON.stringify([
            ["Dynamic Link", "link_doctype", "=", "Supplier"],
            ["Dynamic Link", "link_name", "=", name],
          ]),
          fields: JSON.stringify([
            "name",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "pincode",
            "country",
            "email_id",
            "phone",
            "is_primary_address",
          ]),
          limit_page_length: 20,
        },
      }),
    enabled: !!name,
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<FileRow[]>({
    queryKey: ["supplier-files", name],
    queryFn: () =>
      apiGet<FileRow[]>("/api/resource/File", {
        params: {
          filters: JSON.stringify([
            ["attached_to_doctype", "=", "Supplier"],
            ["attached_to_name", "=", name],
          ]),
          fields: JSON.stringify([
            "name",
            "file_name",
            "file_url",
            "file_size",
            "is_private",
            "creation",
          ]),
          limit_page_length: 100,
          order_by: "creation desc",
        },
      }),
    enabled: !!name && tab === "documents",
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !supplier) {
    return (
      <div>
        <Link
          to="/suppliers"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <EmptyState
          icon={Users}
          title="Supplier not found"
          description="It may have been deleted, or you may not have access."
        />
      </div>
    );
  }

  const isActive = supplier.disabled !== 1;
  const primaryAddress =
    addresses.find((a) => a.is_primary_address === 1) ?? addresses[0];
  const profileIncomplete = isProfileIncomplete(supplier, primaryAddress);

  function handleSupplierSaved() {
    queryClient.invalidateQueries({ queryKey: ["supplier", name] });
    queryClient.invalidateQueries({ queryKey: ["supplier-addresses", name] });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  }

  const TABS = [
    { id: "overview" as const, label: "Overview" },
    {
      id: "purchase-orders" as const,
      label: "Purchase Orders",
      count: tab === "purchase-orders" ? pos.length : undefined,
    },
    {
      id: "invoices" as const,
      label: "Invoices",
      count: tab === "invoices" ? invoices.length : undefined,
    },
    {
      id: "contacts" as const,
      label: "Contacts",
      count: tab === "contacts" ? contacts.length : undefined,
    },
    {
      id: "documents" as const,
      label: "Documents",
      count: tab === "documents" ? files.length : undefined,
    },
  ];

  return (
    <div>
      <Link
        to="/suppliers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to suppliers
      </Link>

      <PageHeader
        title={supplier.supplier_name ?? supplier.name}
        description={supplier.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            >
              <Pencil className="h-4 w-4" />
              Edit Supplier
            </button>
            {supplier.supplier_group && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 ring-1 ring-inset ring-primary-200">
                <Building2 className="h-3 w-3" />
                {supplier.supplier_group}
              </span>
            )}
            <StatusBadge
              status={isActive ? "Active" : "Inactive"}
              tone={isActive ? "success" : "neutral"}
            />
          </div>
        }
      />

      {profileIncomplete && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning-300 bg-warning-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-600" />
            <div>
              <p className="text-sm font-semibold text-warning-900">
                Supplier profile is incomplete
              </p>
              <p className="mt-0.5 text-xs text-warning-700">
                Add contact, address, tax, payment terms, and currency details
                to complete this supplier&apos;s master record.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-warning-500 px-4 py-2 text-sm font-semibold text-white hover:bg-warning-600"
          >
            <Pencil className="h-4 w-4" />
            Complete Supplier Profile
          </button>
        </div>
      )}

      <Tabs<SupplierTab> tabs={TABS} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === "overview" && (
          <OverviewTab supplier={supplier} address={primaryAddress} />
        )}
        {tab === "purchase-orders" && (
          <POsTab loading={posLoading} pos={pos} />
        )}
        {tab === "invoices" && (
          <InvoicesTab loading={invoicesLoading} invoices={invoices} />
        )}
        {tab === "contacts" && (
          <ContactsTab
            loading={contactsLoading}
            contacts={contacts}
            fallbackEmail={supplier.email_id}
            fallbackPhone={supplier.mobile_no}
          />
        )}
        {tab === "documents" && (
          <DocumentsTab loading={filesLoading} files={files} />
        )}
      </div>

      <EditSupplierModal
        open={editOpen}
        supplier={supplier}
        primaryAddress={primaryAddress}
        onClose={() => setEditOpen(false)}
        onSaved={handleSupplierSaved}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Overview                                                                  */
/* -------------------------------------------------------------------------- */

function formatAddressBlock(address?: AddressRow, country?: string): string {
  if (!address) return displayValue(country);
  const lines = [
    address.address_line1,
    address.address_line2,
    [address.city, address.state].filter(Boolean).join(", "),
    address.pincode,
    address.country ?? country,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : "Not Added";
}

function OverviewTab({
  supplier,
  address,
}: {
  supplier: import("../../types/erpnext").Supplier;
  address?: AddressRow;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Contact" icon={Mail} className="lg:col-span-1">
        <Row
          label="Email"
          value={displayValue(supplier.email_id ?? address?.email_id)}
        />
        <Row
          label="Phone"
          value={displayValue(supplier.mobile_no ?? address?.phone)}
        />
        <Row label="Website" value={displayValue(supplier.website)} />
      </Card>

      <Card title="Address" icon={Globe} className="lg:col-span-1">
        <Row
          label="Address"
          value={formatAddressBlock(address, supplier.country)}
        />
        {address && (
          <>
            <Row
              label="City / State"
              value={displayValue(
                [address.city, address.state].filter(Boolean).join(", ")
              )}
            />
            <Row
              label="Country"
              value={displayValue(address.country ?? supplier.country)}
            />
            <Row label="Postal Code" value={displayValue(address.pincode)} />
          </>
        )}
      </Card>

      <Card title="Payment & Tax" icon={Wallet} className="lg:col-span-1">
        <Row label="Tax ID" value={displayValue(supplier.tax_id)} />
        <Row
          label="Payment Terms"
          value={displayValue(supplier.payment_terms ?? "")}
        />
        <Row label="Currency" value={displayValue(supplier.default_currency)} />
        <Row label="On Hold" value={supplier.on_hold ? "Yes" : "No"} />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Purchase Orders                                                           */
/* -------------------------------------------------------------------------- */

function POsTab({
  loading,
  pos,
}: {
  loading: boolean;
  pos: Array<{
    name: string;
    transaction_date?: string;
    status?: string;
    grand_total?: number;
    currency?: string;
    per_received?: number;
    per_billed?: number;
  }>;
}) {
  if (loading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (pos.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="No purchase orders"
        description="This supplier has not been issued a PO yet."
      />
    );
  }

  return (
    <div className="overflow-hidden card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-4 py-3">PO Number</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">% Received</th>
              <th className="px-4 py-3 text-right">% Billed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {pos.map((po) => (
              <tr key={po.name} className="hover:bg-neutral-50">
                <td className="px-4 py-3 font-medium text-neutral-900">
                  <Link
                    to={`/p2p/purchase-orders/${po.name}`}
                    className="hover:text-primary-600 hover:underline"
                  >
                    {po.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {formatDate(po.transaction_date)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={po.status ?? "Draft"} />
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatCurrency(po.grand_total)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-600">
                  {(po.per_received ?? 0).toFixed(0)}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-600">
                  {(po.per_billed ?? 0).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                  */
/* -------------------------------------------------------------------------- */

function InvoicesTab({
  loading,
  invoices,
}: {
  loading: boolean;
  invoices: Array<{
    name: string;
    posting_date?: string;
    due_date?: string;
    status?: string;
    grand_total?: number;
    outstanding_amount?: number;
    currency?: string;
  }>;
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No invoices"
        description="This supplier has not submitted an invoice yet."
      />
    );
  }

  return (
    <div className="overflow-hidden card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {invoices.map((inv) => {
              const overdue =
                inv.status !== "Paid" &&
                inv.status !== "Cancelled" &&
                isOverdue(inv.due_date);
              const out = inv.outstanding_amount ?? 0;
              return (
                <tr key={inv.name} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    {inv.name}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {formatDate(inv.posting_date)}
                  </td>
                  <td
                    className={`px-4 py-3 ${
                      overdue ? "font-medium text-danger-600" : "text-neutral-600"
                    }`}
                  >
                    {formatDate(inv.due_date)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={overdue ? "Overdue" : inv.status ?? "Draft"}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(inv.grand_total)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      out > 0 ? "font-semibold text-danger-600" : "text-neutral-500"
                    }`}
                  >
                    {formatCurrency(out)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Contacts                                                                  */
/* -------------------------------------------------------------------------- */

function ContactsTab({
  loading,
  contacts,
  fallbackEmail,
  fallbackPhone,
}: {
  loading: boolean;
  contacts: ContactRow[];
  fallbackEmail?: string;
  fallbackPhone?: string;
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;

  if (contacts.length === 0) {
    if (fallbackEmail || fallbackPhone) {
      return (
        <div className="card p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900">
            Primary contact
          </h3>
          <div className="mt-3 space-y-2 text-sm text-neutral-600">
            {fallbackEmail && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-neutral-400" /> {fallbackEmail}
              </div>
            )}
            {fallbackPhone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-neutral-400" /> {fallbackPhone}
              </div>
            )}
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        icon={Users}
        title="No contacts"
        description="Add a contact to populate this tab."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {contacts.map((c) => {
        const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ");
        return (
          <div
            key={c.name}
            className="card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-neutral-900">
                {fullName || c.name}
              </h4>
              {c.is_primary_contact === 1 && (
                <StatusBadge status="Primary" tone="success" />
              )}
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-neutral-600">
              {c.email_id && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-neutral-400" />
                  {c.email_id}
                </div>
              )}
              {c.mobile_no && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-neutral-400" />
                  {c.mobile_no}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Documents                                                                 */
/* -------------------------------------------------------------------------- */

function DocumentsTab({
  loading,
  files,
}: {
  loading: boolean;
  files: FileRow[];
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;

  if (files.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents attached"
        description="Attach documents to this supplier to see them here."
      />
    );
  }

  return (
    <div className="overflow-hidden card">
      <ul className="divide-y divide-neutral-200">
        {files.map((f) => (
          <li
            key={f.name}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {f.file_name ?? f.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatDateTime(f.creation)}
                  {f.is_private === 1 && " · Private"}
                </p>
              </div>
            </div>
            {f.file_url && (
              <a
                href={f.file_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Open
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function Card({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  icon: typeof Mail;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`card p-5 shadow-sm ${className}`}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <Icon className="h-4 w-4 text-neutral-400" />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const isEmpty = value === "Not Added";
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`truncate text-right font-medium ${
          isEmpty ? "text-neutral-400 italic" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
