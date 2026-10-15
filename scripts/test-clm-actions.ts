import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

for (const f of [".env", ".env.local"]) {
  const envPath = resolve(process.cwd(), f);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

import { createClmDependencies } from "../api/clmErp";
import { toClmAggregate } from "../api/clmCore";
import { createClmPurchaseOrderDependencies } from "../api/clmPurchaseOrderErp";
import { getClmPurchaseOrder } from "../api/clmPurchaseOrder";

async function run() {
  const deps = createClmPurchaseOrderDependencies();
  const con = await deps.load("Contract", "CON-2026-00005");

  const p = { typ: "internal" as const, role: "procurement_team", email: "procurement.team@netlink.com" };

  try {
    const res = await getClmPurchaseOrder(p, "CON-2026-00005", deps);
    console.log("getClmPurchaseOrder success:", {
      contract: res.contract,
      rfq: res.rfq,
      award: res.award,
      quotation: res.quotation,
      supplier: res.supplier,
      award_value: res.award_value,
      purchase_order: res.purchase_order ? res.purchase_order.name : null,
      completed: res.completed,
    });
  } catch (e: any) {
    console.log("getClmPurchaseOrder error:", e.message);
  }
}

run().catch(console.error);
