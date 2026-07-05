const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

async function run() {
  const res = await fetch(`${baseUrl}/api/method/frappe.client.get_list`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${apiKey}:${apiSecret}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      doctype: 'Custom Field',
      filters: [['fieldname', 'like', '%bidsphere%']],
      fields: ['name', 'dt', 'fieldname', 'fieldtype']
    })
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Data:", JSON.stringify(data, null, 2));
}

run().catch(console.error);
