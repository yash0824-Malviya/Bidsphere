const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

async function run() {
  const res = await fetch(`${baseUrl}/api/method/frappe.utils.change_log.get_versions`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${apiKey}:${apiSecret}`,
      'Accept': 'application/json'
    }
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

run().catch(console.error);
