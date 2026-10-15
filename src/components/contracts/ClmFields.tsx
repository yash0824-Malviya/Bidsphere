import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { clmError, clmViewerKey, lookupClm, type ClmField } from "../../api/clm";
import { uploadFileToERPNextDetailed } from "../../api/legalDocsStorage";
import { useDebounce } from "../../hooks/useDebounce";

export const CLM_INPUT = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500";
export const CLM_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
export const CLM_PRIMARY = "inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

const SYSTEM_FIELDS = new Set(["name", "doctype", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "amended_from", "status", "request_status", "renewal_status", "amendment_status", "approval_status", "submitted_by", "submission_date", "approved_by", "approval_date", "custom_contract_status", "custom_approval_status", "custom_current_approver", "custom_approved_on", "custom_current_version", "custom_final_version_locked", "custom_esign_status", "custom_inteva_signed_date", "custom_supplier_signed_date", "custom_executed_date", "custom_executed_contract", "custom_clm_data", "is_signed", "signed_on", "signed_by_company", "signee_company", "ip_address"]);
const TEXT_FIELDS = new Set(["Small Text", "Long Text", "Text", "Text Editor"]);
export function fieldLabel(field: ClmField): string {
  if (field.fieldname === "owne") return "Owner";
  return field.label?.trim() || field.fieldname.replace(/^custom_/, "").replaceAll("_", " ");
}
export function editableClmFields(fields: ClmField[], doctype: string, allow?: string[]): ClmField[] {
  return fields.filter(field => !field.hidden && !field.read_only &&
    (allow ? allow.includes(field.fieldname) : !SYSTEM_FIELDS.has(field.fieldname) || ((doctype === "Contract Obligation" || doctype === "Contract Milestone") && field.fieldname === "status")) &&
    !["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Table", "Table MultiSelect", "Signature", "JSON", "Code"].includes(field.fieldtype));
}
/** Send only the server's writable field contract, never a full fetched document. */
export function clmFormPayload(fields: ClmField[], doctype: string, values: Record<string, unknown>, allow?: string[]): Record<string, unknown> {
  const permitted = new Set(allow || editableClmFields(fields, doctype).map(field => field.fieldname));
  if (!allow && doctype === "Contract Approval Matrix") { permitted.add("custom_conditions"); permitted.add("custom_approval_stages"); }
  return Object.fromEntries(Object.entries(values).filter(([key]) => permitted.has(key)));
}
export function initialClmValues(fields: ClmField[], doctype: string, actor?: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) if (field.default !== undefined && field.default !== null && !String(field.default).startsWith(":")) {
    values[field.fieldname] = field.fieldtype === "Check" ? Number(field.default) : field.default;
  }
  if (doctype === "Contract") values.party_type = "Supplier";
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  for (const name of ["request_date", "identified_date"]) if (fields.some(field => field.fieldname === name)) values[name] = date;
  for (const name of ["requester", "requested_by", "identified_by"]) if (actor && fields.some(field => field.fieldname === name)) values[name] = actor;
  return values;
}
export function ClmLinkInput({ doctype, value, onChange, required, id, invalid, describedBy, disabled, label }: { doctype: string; value: string; onChange: (value: string) => void; required?: boolean; id?: string; invalid?: boolean; describedBy?: string; disabled?: boolean; label?: string }) {
  const listId = useId();
  const search = useDebounce(value, 250);
  const query = useQuery({ queryKey: ["clm-lookup", doctype, search, clmViewerKey()], queryFn: () => lookupClm(doctype, search), enabled: Boolean(doctype), staleTime: 30_000 });
  return <><input id={id} className={`${CLM_INPUT}${invalid ? " border-rose-500" : ""}`} value={value} onChange={e => onChange(e.target.value)} list={listId} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-label={label} disabled={disabled} autoComplete="off" placeholder={`Search ${doctype.toLowerCase()}`} />
    <datalist id={listId}>{(query.data || []).map(row => <option key={row.name} value={row.name}>{String(row.title || row.supplier_name || row.full_name || row.name)}</option>)}</datalist>
    {query.isError && <p className="mt-1 text-xs text-rose-700">{clmError(query.error)}</p>}</>;
}
function AttachmentField({ field, doctype, name, value, onChange, onBusyChange, id, invalid, describedBy }: { field: ClmField; doctype: string; name?: string; value: string; onChange: (v: string) => void; onBusyChange?: (busy: boolean) => void; id?: string; invalid?: boolean; describedBy?: string }) {
  const [busy, setBusy] = useState(false);
  return <div className="space-y-2"><p className="break-all text-xs text-slate-600">{value ? value.split("/").pop() : "No attachment"}</p>
    {name ? <input id={id} aria-label={`Upload ${fieldLabel(field)}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} type="file" disabled={busy} className="block w-full text-sm text-slate-600" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      const input = e.currentTarget;
      setBusy(true); onBusyChange?.(true); try { const saved = await uploadFileToERPNextDetailed(file, doctype, name, { isPrivate: true }); onChange(saved.file_url); }
      catch (error) { toast.error(clmError(error)); } finally { setBusy(false); onBusyChange?.(false); input.value = ""; }
    }} /> : <p className="text-xs text-slate-500">Save the draft to attach supporting documents.</p>}
    {busy && <p className="text-xs text-blue-700" role="status">Uploading…</p>}</div>;
}
export default function ClmFields({ fields, doctype, values, onChange, name, editableFields, readOnlyFields = [], compact = false, errors = {}, onUploadBusyChange }: {
  fields: ClmField[]; doctype: string; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void;
  name?: string; editableFields?: string[]; readOnlyFields?: string[]; compact?: boolean; errors?: Record<string, string>; onUploadBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const visible = editableClmFields(fields, doctype, editableFields);
  return <div className="grid min-w-0 gap-4 sm:grid-cols-2">{visible.map(field => {
    const value = values[field.fieldname]; const label = fieldLabel(field); const inputId = `${id}-${field.fieldname}`;
    const set = (next: unknown) => onChange({ ...values, [field.fieldname]: next });
    const text = String(value ?? ""); const multiline = TEXT_FIELDS.has(field.fieldtype);
    const error = errors[field.fieldname]; const errorId = `${inputId}-error`;
    const accessibility = { "aria-invalid": error ? true as const : undefined, "aria-describedby": error ? errorId : undefined };
    const inputClass = `${CLM_INPUT}${error ? " border-rose-500" : ""}`;
    return <div key={field.fieldname} data-contract-field={field.fieldname} className={`min-w-0 ${multiline && (!compact || field.fieldname === "contract_terms") ? "sm:col-span-2" : ""}`}>
      {field.fieldtype === "Check" ? <label className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700"><input {...accessibility} type="checkbox" checked={value === true || value === 1 || value === "1"} onChange={e => set(e.target.checked ? 1 : 0)} className="h-4 w-4 rounded border-slate-300" />{label}</label> : <>
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold text-slate-700">{label}{field.reqd ? " *" : ""}</label>
        {readOnlyFields.includes(field.fieldname) ? <input {...accessibility} id={inputId} className={`${inputClass} bg-slate-50`} value={text} readOnly aria-readonly="true" />
          : field.fieldtype === "Select" ? <select {...accessibility} id={inputId} className={inputClass} value={text} required={Boolean(field.reqd)} onChange={e => set(e.target.value)}><option value="">Select {label.toLowerCase()}</option>{(field.options || "").split("\n").filter(Boolean).map(option => <option key={option}>{option}</option>)}</select>
          : field.fieldtype === "Link" || field.fieldtype === "Dynamic Link" ? <ClmLinkInput id={inputId} invalid={Boolean(error)} describedBy={error ? errorId : undefined} doctype={field.fieldtype === "Dynamic Link" ? String(values[field.options || ""] || "") : field.options || ""} value={text} required={Boolean(field.reqd)} onChange={set} />
          : field.fieldtype === "Attach" || field.fieldtype === "Attach Image" ? <AttachmentField id={inputId} invalid={Boolean(error)} describedBy={error ? errorId : undefined} field={field} doctype={doctype} name={name} value={text} onChange={set} onBusyChange={onUploadBusyChange} />
          : multiline ? <textarea {...accessibility} id={inputId} className={`${inputClass} resize-y`} rows={field.fieldname === "contract_terms" ? compact ? 5 : 12 : 3} value={text} required={Boolean(field.reqd)} onChange={e => set(e.target.value)} />
          : <input {...accessibility} id={inputId} className={inputClass} type={field.fieldtype === "Date" ? "date" : field.fieldtype === "Datetime" ? "datetime-local" : ["Currency", "Float", "Int", "Percent"].includes(field.fieldtype) ? "number" : field.options === "Email" ? "email" : "text"} step={field.fieldtype === "Int" ? "1" : "any"} value={field.fieldtype === "Datetime" ? text.replace(" ", "T") : text} required={Boolean(field.reqd)} onChange={e => set(["Currency", "Float", "Int", "Percent"].includes(field.fieldtype) && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />}
      </>}
      {field.description && <p className="mt-1 text-xs text-slate-500">{field.description.replace(/<[^>]*>/g, "")}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-rose-700">{error}</p>}
    </div>;
  })}</div>;
}
