import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Loader2, X } from "lucide-react";

import { apiGet, apiPost, apiPut } from "../api/erpnext";
import { updateSupplier } from "../api/supplier";
import type { Supplier } from "../types/erpnext";

interface AddressSnapshot {
  name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

interface PaymentTermsRow {
  name: string;
}

interface CurrencyRow {
  name: string;
}

export type SupplierStatus = "Active" | "Inactive";

export interface EditSupplierFormValues {
  supplierName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  taxId: string;
  paymentTerms: string;
  currency: string;
  status: SupplierStatus;
}

interface Props {
  open: boolean;
  supplier: Supplier;
  primaryAddress?: AddressSnapshot;
  onClose: () => void;
  onSaved: () => void;
}

function buildAddressText(address?: AddressSnapshot): string {
  if (!address) return "";
  return [
    address.address_line1,
    address.address_line2,
    [address.city, address.state].filter(Boolean).join(", "),
    address.pincode,
    address.country,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEditFormValues(
  supplier: Supplier,
  address?: AddressSnapshot
): EditSupplierFormValues {
  return {
    supplierName: supplier.supplier_name ?? supplier.name ?? "",
    email: supplier.email_id ?? "",
    phone: supplier.mobile_no ?? "",
    website: supplier.website ?? "",
    address: buildAddressText(address),
    taxId: supplier.tax_id ?? "",
    paymentTerms: supplier.payment_terms ?? "",
    currency: supplier.default_currency ?? "",
    status: supplier.disabled === 1 ? "Inactive" : "Active",
  };
}

export default function EditSupplierModal({
  open,
  supplier,
  primaryAddress,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<EditSupplierFormValues>(() =>
    buildEditFormValues(supplier, primaryAddress)
  );

  useEffect(() => {
    if (!open) return;
    setForm(buildEditFormValues(supplier, primaryAddress));
  }, [open, supplier, primaryAddress]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { data: paymentTermTemplates = [] } = useQuery<PaymentTermsRow[]>({
    queryKey: ["payment-terms-templates"],
    queryFn: () =>
      apiGet<PaymentTermsRow[]>("/api/resource/Payment Terms Template", {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 200,
          order_by: "name asc",
        },
      }),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const { data: currencies = [] } = useQuery<CurrencyRow[]>({
    queryKey: ["currencies"],
    queryFn: () =>
      apiGet<CurrencyRow[]>("/api/resource/Currency", {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify([["enabled", "=", 1]]),
          limit_page_length: 100,
          order_by: "name asc",
        },
      }),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: EditSupplierFormValues) => {
      if (!values.supplierName.trim()) {
        throw new Error("Supplier name is required.");
      }
      if (
        values.email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())
      ) {
        throw new Error("Email address looks invalid.");
      }

      await updateSupplier(supplier.name, {
        supplier_name: values.supplierName.trim(),
        email_id: values.email.trim() || undefined,
        mobile_no: values.phone.trim() || undefined,
        website: values.website.trim() || undefined,
        tax_id: values.taxId.trim() || undefined,
        payment_terms: values.paymentTerms || undefined,
        default_currency: values.currency || undefined,
        disabled: values.status === "Inactive" ? 1 : 0,
      });

      const addressLine = values.address.trim();
      if (addressLine) {
        if (primaryAddress?.name) {
          await apiPut(`/api/resource/Address/${primaryAddress.name}`, {
            address_line1: addressLine.split("\n")[0] ?? addressLine,
            address_line2:
              addressLine.split("\n").slice(1).join(", ") || undefined,
          });
        } else {
          await apiPost("/api/resource/Address", {
            address_title: values.supplierName.trim(),
            address_type: "Office",
            address_line1: addressLine.split("\n")[0] ?? addressLine,
            address_line2:
              addressLine.split("\n").slice(1).join(", ") || undefined,
            country: supplier.country || undefined,
            is_primary_address: 1,
            links: [{ link_doctype: "Supplier", link_name: supplier.name }],
          });
        }
      }
    },
    onSuccess: () => {
      toast.success("Supplier profile updated successfully.");
      onSaved();
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not update supplier.");
    },
  });

  if (!open) return null;

  function setField<K extends keyof EditSupplierFormValues>(
    key: K,
    value: EditSupplierFormValues[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-supplier-title"
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div>
            <h2
              id="edit-supplier-title"
              className="text-base font-semibold text-neutral-900"
            >
              Edit Supplier
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">{supplier.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate(form);
          }}
          className="overflow-y-auto px-5 py-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier Name" required className="sm:col-span-2">
              <input
                value={form.supplierName}
                onChange={(e) => setField("supplierName", e.target.value)}
                className={inputClass}
                placeholder="Acme Corporation"
              />
            </Field>

            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                className={inputClass}
                placeholder="contact@supplier.com"
              />
            </Field>

            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                className={inputClass}
                placeholder="+91 98765 43210"
              />
            </Field>

            <Field label="Website" className="sm:col-span-2">
              <input
                value={form.website}
                onChange={(e) => setField("website", e.target.value)}
                className={inputClass}
                placeholder="https://www.supplier.com"
              />
            </Field>

            <Field label="Address" className="sm:col-span-2">
              <textarea
                value={form.address}
                onChange={(e) => setField("address", e.target.value)}
                rows={3}
                className={inputClass}
                placeholder="Street, city, state, postal code"
              />
            </Field>

            <Field label="Tax ID">
              <input
                value={form.taxId}
                onChange={(e) => setField("taxId", e.target.value)}
                className={inputClass}
                placeholder="GSTIN / VAT / EIN"
              />
            </Field>

            <Field label="Payment Terms">
              <select
                value={form.paymentTerms}
                onChange={(e) => setField("paymentTerms", e.target.value)}
                className={inputClass}
              >
                <option value="">Default</option>
                {paymentTermTemplates.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Currency">
              <select
                value={form.currency}
                onChange={(e) => setField("currency", e.target.value)}
                className={inputClass}
              >
                <option value="">Not set</option>
                {currencies.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Supplier Status">
              <select
                value={form.status}
                onChange={(e) =>
                  setField("status", e.target.value as SupplierStatus)
                }
                className={inputClass}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <p className="mt-1.5 text-xs text-neutral-500">
                {form.status === "Inactive"
                  ? "Inactive suppliers are hidden from new RFQs and purchase orders. Existing records stay intact."
                  : "Active suppliers are available for RFQs and purchase orders."}
              </p>
            </Field>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saveMutation.isPending}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
            >
              {saveMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

function Field({
  label,
  required,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-danger-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
