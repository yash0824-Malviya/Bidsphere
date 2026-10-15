/** Opt-in server diagnostics. Never log full ERP documents, errors, or credentials. */
type Row = Record<string, unknown>;
type Event = "rfq_saved" | "rfq_reloaded" | "routing_attempt" | "routing_skipped" | "request_payload" | "request_schema_blocked" | "request_create_attempt" | "request_create_response" | "request_create_failed" | "request_recovered" | "request_reused" | "routing_result" | "routing_failed" | "save_followup_failed";
const idFields = ["rfq_id", "request_id", "department_id"] as const;
const labelFields = ["contract_required", "actor_role", "assigned_role", "status", "current_stage", "request_status", "approval_status", "phase", "error_name"] as const;
const flagFields = ["created", "has_requester", "has_department", "has_supplier", "has_award", "has_contract_start_date", "has_contract_end_date", "has_contract_purpose", "has_description"] as const;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safeText = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit && /^[\w .-]*$/.test(value) ? value : undefined;

export function logRfqClmDiagnostic(event: Event, details: Row = {}): void {
  if (!/^(1|true|on)$/i.test(process.env.RFQ_CLM_DEBUG || "")) return;
  try {
    const safe: Row = { event };
    for (const field of idFields) {
      const value = safeText(details[field], 140);
      if (value !== undefined) safe[field] = value;
    }
    for (const field of labelFields) {
      const value = safeText(details[field], 64);
      if (value !== undefined) safe[field] = value;
    }
    if (typeof details.contract_required === "boolean") safe.contract_required = details.contract_required;
    for (const field of flagFields) if (typeof details[field] === "boolean") safe[field] = details[field];
    if (Number.isInteger(details.error_status) && Number(details.error_status) >= 100 && Number(details.error_status) <= 599) safe.error_status = details.error_status;
    for (const key of ["payload_fields", "missing_fields"]) if (Array.isArray(details[key])) safe[key] = details[key].filter(value => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value)).slice(0, 80);
    console.info("[rfq-clm]", safe);
  } catch { /* Diagnostics must not alter persistence or error propagation. */ }
}

export function rfqClmErrorDiagnostic(error: unknown): Row {
  const value = object(error);
  const known = ["Error", "ClmError", "RbacError", "TypeError", "AbortError", "FetchError", "AxiosError", "RfqInitialClmRoutingError"];
  return { error_name: error instanceof Error && known.includes(error.name) ? error.name : "UnknownError", error_status: value.status };
}

/** Structural payload/response summary: optional business values remain private. */
export function rfqClmRequestDiagnostic(record: unknown): Row {
  const row = object(record);
  let data: Row = {};
  try { data = object(typeof row.custom_clm_data === "string" ? JSON.parse(row.custom_clm_data) : row.custom_clm_data); } catch { /* Report the available IDs without interpreting malformed metadata. */ }
  const source = object(data.rfq_source), route = object(data.rfq_request_workflow);
  const present = (value: unknown) => value !== undefined && value !== null && value !== "";
  return {
    rfq_id: row.custom_rfq, request_id: row.name, department_id: row.department,
    contract_required: source.contract_required, request_status: row.request_status, approval_status: row.approval_status,
    assigned_role: route.assigned_role, current_stage: route.current_stage, status: route.status, phase: route.phase,
    has_requester: present(row.requester), has_department: present(row.department), has_supplier: present(row.supplier),
    has_award: present(object(source.available_award).award), has_contract_start_date: present(row.contract_start_date),
    has_contract_end_date: present(row.contract_end_date), has_contract_purpose: present(row.contract_purpose), has_description: present(row.description),
    payload_fields: Object.keys(row),
  };
}
