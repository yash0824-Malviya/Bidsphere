import fetch from "node-fetch";

const ERP_URL = "http://80.225.204.210:8090";
const HEADERS = {
  Authorization: "token d38c611ab48e170:9aac303194dc746",
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${ERP_URL}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception || json._server_messages || JSON.stringify(json) || res.statusText,
    );
  }
  return json.data;
}

const BC_FIELDS = [
  { fieldname: "finance_status", label: "Finance Status", fieldtype: "Select", options: "Pending\nApproved\nRejected\nRevision Requested", default: "Pending" },
  { fieldname: "finance_approved_by", label: "Finance Approved By", fieldtype: "Data" },
  { fieldname: "finance_approved_on", label: "Finance Approved On", fieldtype: "Datetime" },
  { fieldname: "finance_comments", label: "Finance Comments", fieldtype: "Small Text" },
  { fieldname: "legal_status", label: "Legal Status", fieldtype: "Select", options: "Pending\nApproved\nRejected\nRevision Requested", default: "Pending" },
  { fieldname: "legal_approved_by", label: "Legal Approved By", fieldtype: "Data" },
  { fieldname: "legal_approved_on", label: "Legal Approved On", fieldtype: "Datetime" },
  { fieldname: "legal_comments", label: "Legal Comments", fieldtype: "Small Text" },
  { fieldname: "rejection_reason", label: "Rejection Reason", fieldtype: "Small Text" },
  { fieldname: "rfq_id", label: "RFQ ID", fieldtype: "Data" },
  { fieldname: "custom_rfq_id", label: "Custom RFQ ID", fieldtype: "Data" },
];

const APPROVAL_FIELDS = [
  { fieldname: "action", label: "Action", fieldtype: "Data" },
  { fieldname: "previous_state", label: "Previous State", fieldtype: "Data" },
  { fieldname: "new_state", label: "New State", fieldtype: "Data" },
  { fieldname: "user_role", label: "User Role", fieldtype: "Data" },
];

async function ensureCustomFields(doctype, fields) {
  console.log(`Ensuring custom fields for ${doctype}...`);
  const existing = await api(
    "GET",
    `/api/resource/Custom Field?filters=${encodeURIComponent(
      JSON.stringify([
        ["dt", "=", doctype],
        ["fieldname", "in", fields.map((f) => f.fieldname)],
      ]),
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "fieldname"]))}&limit_page_length=100`,
  );

  const existingMap = new Map((existing || []).map((r) => [r.fieldname, r.name]));

  for (const f of fields) {
    if (existingMap.has(f.fieldname)) {
      console.log(`  - Field ${f.fieldname} already exists on ${doctype}`);
    } else {
      console.log(`  + Creating field ${f.fieldname} on ${doctype}...`);
      await api("POST", "/api/resource/Custom Field", {
        dt: doctype,
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        default: f.default,
        insert_after: "workflow_state",
      });
      console.log(`    Created ${f.fieldname}`);
    }
  }
}

async function main() {
  await ensureCustomFields("Business Case", BC_FIELDS);
  await ensureCustomFields("Business Case Approval", APPROVAL_FIELDS);
  console.log("Done ensuring Custom Fields!");
}

main().catch(console.error);
