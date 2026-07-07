/**
 * Create the "Reverse Bid Item" child DocType (item-wise reverse bidding) and
 * attach it to the "Reverse Bidding" master via a `bid_items` Table field.
 *
 * Each Reverse Bid Item row holds the current item-wise price state for one
 * (supplier, RFQ item) pair, updated live as suppliers submit lower per-item
 * bids. The parent series + existing children are unchanged.
 *
 * Idempotent — safe to re-run. Run: node scripts/setup-reverse-bid-item.mjs
 */
const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

const RBI = "Reverse Bid Item";

const FIELDS = [
  { fieldname: "reverse_bidding", label: "Reverse Bidding", fieldtype: "Data", read_only: 1 },
  { fieldname: "supplier", label: "Supplier", fieldtype: "Link", options: "Supplier", in_list_view: 1, reqd: 1 },
  { fieldname: "item_code", label: "Item Code", fieldtype: "Data", in_list_view: 1, reqd: 1 },
  { fieldname: "item_name", label: "Item Name", fieldtype: "Data" },
  { fieldname: "rfq_item", label: "RFQ Item", fieldtype: "Data" },
  { fieldname: "qty", label: "Quantity", fieldtype: "Float", in_list_view: 1 },
  { fieldname: "uom", label: "UOM", fieldtype: "Data" },
  { fieldname: "initial_rate", label: "Initial Rate", fieldtype: "Currency" },
  { fieldname: "current_rate", label: "Current Rate", fieldtype: "Currency", in_list_view: 1 },
  { fieldname: "latest_rate", label: "Latest Submitted Rate", fieldtype: "Currency" },
  { fieldname: "target_rate", label: "Procurement Target Rate", fieldtype: "Currency" },
  { fieldname: "amount", label: "Total Amount", fieldtype: "Currency" },
  { fieldname: "rank", label: "Rank", fieldtype: "Int" },
  { fieldname: "is_lowest", label: "Is Lowest Bid", fieldtype: "Check" },
  { fieldname: "bid_time", label: "Bid Time", fieldtype: "Datetime" },
  { fieldname: "round_number", label: "Round Number", fieldtype: "Int" },
  { fieldname: "status", label: "Status", fieldtype: "Select", options: "Waiting\nActive\nLeading\nOutbid\nWinner" },
];

async function docExists(dt, name) {
  const res = await fetch(
    `${baseUrl}/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`,
    { headers }
  );
  return res.ok;
}

async function createDocType() {
  if (await docExists("DocType", RBI)) {
    console.log(`DocType "${RBI}" already exists — skipping create.`);
    return;
  }
  console.log(`Creating DocType "${RBI}"...`);
  const res = await fetch(`${baseUrl}/api/resource/DocType`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      doctype: "DocType",
      name: RBI,
      module: "Buying",
      custom: 1,
      istable: 1,
      editable_grid: 1,
      autoname: "hash",
      naming_rule: "Random",
      fields: FIELDS,
      permissions: [],
    }),
  });
  console.log("Create status:", res.status);
  if (!res.ok) console.log(await res.text());
}

async function addParentField() {
  // Add bid_items Table field to Reverse Bidding via Custom Field (idempotent).
  const cfName = "Reverse Bidding-bid_items";
  if (await docExists("Custom Field", cfName)) {
    console.log("Custom Field bid_items already exists — skipping.");
    return;
  }
  console.log("Adding bid_items Table field to Reverse Bidding...");
  const res = await fetch(`${baseUrl}/api/resource/Custom Field`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      doctype: "Custom Field",
      dt: "Reverse Bidding",
      fieldname: "bid_items",
      label: "Bid Items",
      fieldtype: "Table",
      options: RBI,
      insert_after: "bid_history",
    }),
  });
  console.log("Custom Field status:", res.status);
  if (!res.ok) console.log(await res.text());
}

async function ensureItemField() {
  // Add target_rate to an already-existing Reverse Bid Item DocType.
  const res = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(RBI)}`,
    { headers }
  );
  if (!res.ok) return;
  const { data } = await res.json();
  const has = (data.fields || []).some((f) => f.fieldname === "target_rate");
  const cfName = `${RBI}-target_rate`;
  if (has || (await docExists("Custom Field", cfName))) {
    console.log("target_rate field already present — skipping.");
    return;
  }
  console.log("Adding target_rate field to Reverse Bid Item...");
  const cf = await fetch(`${baseUrl}/api/resource/Custom Field`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      doctype: "Custom Field",
      dt: RBI,
      fieldname: "target_rate",
      label: "Procurement Target Rate",
      fieldtype: "Currency",
      insert_after: "latest_rate",
    }),
  });
  console.log("target_rate Custom Field status:", cf.status);
  if (!cf.ok) console.log(await cf.text());
}

async function verify() {
  const res = await fetch(
    `${baseUrl}/api/resource/DocType/Reverse Bidding`,
    { headers }
  );
  if (res.ok) {
    const { data } = await res.json();
    const f = (data.fields || []).find((x) => x.fieldname === "bid_items");
    console.log(
      "\nParent bid_items field:",
      f ? `${f.fieldtype} → ${f.options}` : "NOT FOUND (may be a Custom Field, checking...)"
    );
  }
  const rbi = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(RBI)}?fields=["name","istable","autoname"]`,
    { headers }
  );
  if (rbi.ok) console.log("Reverse Bid Item:", JSON.stringify((await rbi.json()).data));
}

async function run() {
  await createDocType();
  await addParentField();
  await ensureItemField();
  await verify();
  console.log("\nDone.");
}

run().catch(console.error);
