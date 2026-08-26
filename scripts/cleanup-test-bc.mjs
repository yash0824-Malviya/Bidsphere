import fetch from "node-fetch";

const ERP_URL = "http://80.225.204.210:8090";
const HEADERS = {
  Authorization: "token d38c611ab48e170:9aac303194dc746",
  "Content-Type": "application/json",
};

async function main() {
  console.log("=== 1. Inspecting BC-2026-00003 ===");
  const res = await fetch(`${ERP_URL}/api/resource/Business Case/BC-2026-00003`, { headers: HEADERS });
  const data = await res.json();
  console.log("Current Doc:", JSON.stringify(data.data, null, 2));

  // Reset fields to valid initial state
  console.log("\n=== 2. Resetting BC-2026-00003 to clean Pending Finance Review state ===");
  const updateRes = await fetch(`${ERP_URL}/api/method/frappe.client.set_value`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      doctype: "Business Case",
      name: "BC-2026-00003",
      fieldname: {
        workflow_state: "Pending Finance Review",
        status: "Pending Approval",
        finance_status: "Pending",
        finance_approved_by: null,
        finance_approved_on: null,
        finance_comments: null,
        legal_status: "Pending",
        legal_approved_by: null,
        legal_approved_on: null,
        legal_comments: null,
        rejection_reason: null,
        rfq_id: null,
        custom_rfq_id: null,
        capex: 200000,
        opex_year: 0,
        expected_annual_savings: 70000,
        revenue_increase__year: 0,
        cost_avoidance__year: 0,
        project_duration: 5,
        discount_rate: 10,
        total_investment: 200000,
        annual_gross_benefit: 70000,
        annual_net_benefit: 70000,
        total_net_benefit: 350000,
        net_project_gain: 150000,
        roi: 75,
        npv: 65355.07,
        irr: 22.11,
        payback_period: 34.29,
        financial_calculation_status: "Calculated",
        financial_calculation_message: "Financial calculations completed successfully.",
      }
    })
  });
  console.log("Update result:", await updateRes.json());

  // Clean test approval history child rows
  console.log("\n=== 3. Cleaning test approval history child rows ===");
  const approvalRows = await fetch(
    `${ERP_URL}/api/resource/Business Case Approval?filters=[["parent","=","BC-2026-00003"]]&fields=["name","comments","action"]`,
    { headers: HEADERS }
  );
  const rowsData = await approvalRows.json();
  console.log("Existing approval rows:", rowsData);
  for (const r of rowsData.data || []) {
    if (r.comments?.includes("Test") || r.comments?.includes("test")) {
      console.log(`Deleting test approval row: ${r.name}`);
      await fetch(`${ERP_URL}/api/resource/Business Case Approval/${r.name}`, {
        method: "DELETE",
        headers: HEADERS,
      });
    }
  }

  const finalCheck = await fetch(`${ERP_URL}/api/resource/Business Case/BC-2026-00003`, { headers: HEADERS });
  console.log("\n=== Final Doc state ===", await finalCheck.json());
}

main().catch(console.error);
