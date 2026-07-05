const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

async function queryDocType(doctype) {
  console.log(`Querying ${doctype}...`);
  try {
    const res = await fetch(`${baseUrl}/api/method/frappe.client.get_list`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${apiKey}:${apiSecret}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ doctype })
    });
    const data = await res.json();
    console.log(`${doctype} count:`, data.message ? data.message.length : 0);
    console.log(`${doctype} data:`, JSON.stringify(data.message || data, null, 2));
  } catch (err) {
    console.error(`Error querying ${doctype}:`, err);
  }
}

async function run() {
  await queryDocType("Server Script");
  await queryDocType("Client Script");
}

run().catch(console.error);
