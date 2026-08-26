import fetch from "node-fetch";

const ERP_URL = "http://80.225.204.210:8090";
const HEADERS = {
  Authorization: "token d38c611ab48e170:9aac303194dc746",
  "Content-Type": "application/json",
};

async function main() {
  console.log("=== Inspecting DocField for stage on Business Case Approval ===");
  const res = await fetch(
    `${ERP_URL}/api/resource/DocField?filters=[["parent","=","Business Case Approval"],["fieldname","=","stage"]]&fields=["*"]`,
    { headers: HEADERS }
  );
  const data = await res.json();
  console.log("DocField stage data:", data);

  if (data.data && data.data.length > 0) {
    const docFieldName = data.data[0].name;
    console.log(`Updating DocField ${docFieldName}...`);
    const updateRes = await fetch(`${ERP_URL}/api/resource/DocField/${docFieldName}`, {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify({
        options: "Finance\nLegal\nProcurement\nExecutive\nDepartment"
      })
    });
    console.log("Update result:", await updateRes.json());
  }

  // Also check if approver field link requires valid User
  const approverField = await fetch(
    `${ERP_URL}/api/resource/DocField?filters=[["parent","=","Business Case Approval"],["fieldname","=","approver"]]&fields=["*"]`,
    { headers: HEADERS }
  );
  console.log("Approver field:", await approverField.json());
}

main().catch(console.error);
