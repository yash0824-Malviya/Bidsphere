/**
 * Add an `invitation_sent_at` (Datetime) field to the "Reverse Bidding Supplier"
 * child DocType so invitations record when they were sent. Idempotent.
 *
 * Run: node scripts/add-invitation-sent-at.mjs
 */
const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";
const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

const DT = "Reverse Bidding Supplier";
const FIELD = "invitation_sent_at";

async function exists(dt, name) {
  const res = await fetch(
    `${baseUrl}/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`,
    { headers }
  );
  return res.ok;
}

async function run() {
  const docTypeRes = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(DT)}`,
    { headers }
  );
  if (docTypeRes.ok) {
    const { data } = await docTypeRes.json();
    if ((data.fields || []).some((f) => f.fieldname === FIELD)) {
      console.log(`${FIELD} already a standard field — skipping.`);
      return;
    }
  }
  const cfName = `${DT}-${FIELD}`;
  if (await exists("Custom Field", cfName)) {
    console.log(`${FIELD} Custom Field already exists — skipping.`);
    return;
  }
  const res = await fetch(`${baseUrl}/api/resource/Custom Field`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      doctype: "Custom Field",
      dt: DT,
      fieldname: FIELD,
      label: "Invitation Sent At",
      fieldtype: "Datetime",
      insert_after: "invitation_status",
      read_only: 1,
    }),
  });
  console.log("Create status:", res.status);
  if (!res.ok) console.log(await res.text());
  else console.log(`Added ${FIELD} to ${DT}.`);
}

run().catch(console.error);
