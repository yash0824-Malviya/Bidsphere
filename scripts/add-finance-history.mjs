import fetch from "node-fetch";

const ERP_URL = "http://80.225.204.210:8090";
const HEADERS = {
  Authorization: "token d38c611ab48e170:9aac303194dc746",
  "Content-Type": "application/json",
};

async function main() {
  const insertRes = await fetch(`${ERP_URL}/api/method/frappe.client.insert`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      doc: {
        doctype: "Business Case Approval",
        parenttype: "Business Case",
        parent: "BC-2026-00003",
        parentfield: "approval_history",
        stage: "Finance",
        approver: "finance@netlink.com",
        role: "Finance Manager",
        status: "Approved",
        comments: "Financial analysis verified and budget approved.",
        approved_on: "2026-08-18 10:15:43",
      }
    })
  });
  console.log("Finance insert result:", await insertRes.json());
}

main().catch(console.error);
