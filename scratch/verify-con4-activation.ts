import { createClmDependencies } from "../api/clmErp.ts";
import { applyClmAction } from "../api/clmCore.ts";
import type { AccessPrincipal } from "../api/rbacAuth.ts";

async function main() {
  const deps = createClmDependencies();
  const doc = await deps.load("Contract", "CON-2026-00004");
  console.log("ACTUAL_CONTRACT_DATA:", JSON.stringify({
    name: doc.name,
    start_date: doc.start_date,
    end_date: doc.end_date,
    custom_contract_status: doc.custom_contract_status,
    status: doc.status,
    modified: doc.modified,
    business_now: deps.now(),
  }, null, 2));

  const team: AccessPrincipal = {
    typ: "internal",
    role: "procurement_team",
    email: "procurement.team@netlink.com",
    sub: "procurement.team@netlink.com",
    iat: 1,
    exp: Number.MAX_SAFE_INTEGER,
  };

  // Test 1: Real business date (2026-10-13) against live CON-2026-00004
  console.log("\n--- TEST 1: Live activation on current business date (2026-10-13) ---");
  try {
    await applyClmAction(
      {
        doctype: "Contract",
        name: "CON-2026-00004",
        action: "activate",
        comment: "Test activation on current date",
        expected_modified: doc.modified,
      },
      team,
      deps,
    );
    console.error("FAIL: Expected activation to be rejected on 2026-10-13");
  } catch (err: any) {
    console.log("RESULT_REJECTED:", err.message);
  }

  // Test 2: Effective date simulated (2026-10-15) - verification without persisting changes to ERP
  console.log("\n--- TEST 2: Activation on effective start date (2026-10-15) ---");
  let simulatedSaveCalled = false;
  let simulatedSavedRecord: any = null;
  const simulatedDeps = {
    ...deps,
    now: () => "2026-10-15 10:00:00",
    save: async (dt: string, record: any) => {
      simulatedSaveCalled = true;
      simulatedSavedRecord = record;
      return record;
    },
  };
  try {
    const result = await applyClmAction(
      {
        doctype: "Contract",
        name: "CON-2026-00004",
        action: "activate",
        comment: "Effective date reached",
        expected_modified: doc.modified,
      },
      team,
      simulatedDeps,
    );
    console.log("RESULT_ALLOWED: Status became:", result.record.custom_contract_status);
    console.log("Simulated save called:", simulatedSaveCalled);
  } catch (err: any) {
    console.error("FAIL on 2026-10-15:", err);
  }

  // Test 3: Past expiration date simulated (2027-10-15)
  console.log("\n--- TEST 3: Activation after contract expiration (2027-10-15) ---");
  const expiredDeps = {
    ...deps,
    now: () => "2027-10-15 10:00:00",
  };
  try {
    await applyClmAction(
      {
        doctype: "Contract",
        name: "CON-2026-00004",
        action: "activate",
        comment: "Attempt activation after end date",
        expected_modified: doc.modified,
      },
      team,
      expiredDeps,
    );
    console.error("FAIL: Expected activation to be rejected on 2027-10-15");
  } catch (err: any) {
    console.log("RESULT_EXPIRED:", err.message);
  }
}

main().catch(console.error);
