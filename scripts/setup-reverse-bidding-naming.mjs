/**
 * Configure naming for the Reverse Bidding DocTypes.
 *
 * Root cause of the "Please set the document name" error when creating a
 * Reverse Bidding: the child tables "Reverse Bidding Supplier" and
 * "Reverse Bids" shipped with autoname = "prompt" (naming_rule "Set by user").
 * A child row inserted without a manually-set name then fails naming.
 *
 * This script sets both child tables to hash / Random naming so their rows are
 * auto-named when the parent is saved. The parent "Reverse Bidding" already
 * uses the "RB-.YYYY.-.#####" naming series (unchanged here).
 *
 * Idempotent — safe to re-run. Run with: node scripts/setup-reverse-bidding-naming.mjs
 */
const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

const CHILD_DOCTYPES = ["Reverse Bidding Supplier", "Reverse Bids"];

async function ensureHashNaming(child) {
  console.log(`\n=== ${child} ===`);
  const res = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(child)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ autoname: "hash", naming_rule: "Random" }),
    }
  );
  console.log("PUT status:", res.status);
  const check = await fetch(
    `${baseUrl}/api/resource/DocType/${encodeURIComponent(child)}?fields=["autoname","naming_rule"]`,
    { headers }
  );
  if (check.ok) {
    const { data } = await check.json();
    console.log("autoname:", data.autoname, "| naming_rule:", data.naming_rule);
  } else {
    console.error("Verify failed:", check.status, await check.text());
  }
}

async function run() {
  for (const dt of CHILD_DOCTYPES) await ensureHashNaming(dt);
  console.log("\nDone.");
}

run().catch(console.error);
