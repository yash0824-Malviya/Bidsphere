const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

async function checkMethod(path, body = {}) {
  console.log(`Checking ${path}...`);
  try {
    const res = await fetch(`${baseUrl}/api/method/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${apiKey}:${apiSecret}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response snippet: ${text.slice(0, 1000)}`);
  } catch (err) {
    console.error("Error:", err);
  }
}

async function run() {
  await checkMethod("scripts.erpnext.material_request_workflow.bidsphere_issue_material");
  await checkMethod("scripts.erpnext.material_request_workflow.bidsphere_transfer_and_issue_material");
}

run().catch(console.error);
