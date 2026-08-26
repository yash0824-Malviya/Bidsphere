import fetch from "node-fetch";

const ERP_URL = "http://80.225.204.210:8090";
const HEADERS = {
  Authorization: "token d38c611ab48e170:9aac303194dc746",
  "Content-Type": "application/json",
};

async function main() {
  const r = await fetch(`${ERP_URL}/api/resource/User?fields=["name","email","full_name"]&limit_page_length=50`, { headers: HEADERS });
  const data = await r.json();
  console.log("Existing Users:", data.data);

  // Test inserting Business Case Approval with legal@netlink.com vs Administrator
  const test1 = await fetch(`${ERP_URL}/api/method/frappe.client.insert`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      doc: {
        doctype: "Business Case Approval",
        parenttype: "Business Case",
        parent: "BC-2026-00003",
        parentfield: "approval_history",
        stage: "Legal",
        approver: "legal@netlink.com",
        role: "Legal Reviewer",
        status: "Approved",
        comments: "Test legal insert",
        approved_on: "2026-08-18 10:17:09",
      }
    })
  });
  console.log("Insert with legal@netlink.com:", await test1.json());
}

main().catch(console.error);
