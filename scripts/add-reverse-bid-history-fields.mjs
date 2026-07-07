/**
 * Add item-level history fields to the "Reverse Bids" child DocType so every
 * submitted bid records a per-item history row (item, previous price, new
 * price, reduction). Idempotent — safe to re-run.
 *
 * Run: node scripts/add-reverse-bid-history-fields.mjs
 */
const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";
const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

const DT = "Reverse Bids";

/** ordered so insert_after chains correctly */
const FIELDS = [
  { fieldname: "item_code", label: "Item Code", fieldtype: "Data", insert_after: "supplier" },
  { fieldname: "item_name", label: "Item Name", fieldtype: "Data", insert_after: "item_code" },
  { fieldname: "previous_rate", label: "Previous Price", fieldtype: "Currency", insert_after: "bid_amount" },
  { fieldname: "reduction_amount", label: "Reduction Amount", fieldtype: "Currency", insert_after: "previous_rate" },
  { fieldname: "reduction_pct", label: "Reduction %", fieldtype: "Float", insert_after: "reduction_amount" },
];

async function exists(dt, name) {
  const res = await fetch(
    `${baseUrl}/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`,
    { headers }
  );
  return res.ok;
}

async function run() {
  const dtRes = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(DT)}`,
    { headers }
  );
  const standard = dtRes.ok
    ? new Set(((await dtRes.json()).data.fields || []).map((f) => f.fieldname))
    : new Set();

  for (const f of FIELDS) {
    if (standard.has(f.fieldname)) {
      console.log(`${f.fieldname}: already a standard field — skipping.`);
      continue;
    }
    const cfName = `${DT}-${f.fieldname}`;
    if (await exists("Custom Field", cfName)) {
      console.log(`${f.fieldname}: Custom Field already exists — skipping.`);
      continue;
    }
    const res = await fetch(`${baseUrl}/api/resource/Custom Field`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        doctype: "Custom Field",
        dt: DT,
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        insert_after: f.insert_after,
      }),
    });
    console.log(`${f.fieldname}: create status ${res.status}`);
    if (!res.ok) console.log("  ", (await res.text()).slice(0, 300));
  }
  console.log("Done.");
}

run().catch(console.error);
