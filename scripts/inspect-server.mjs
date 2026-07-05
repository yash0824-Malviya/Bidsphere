const apiKey = "d38c611ab48e170";
const apiSecret = "9aac303194dc746";
const baseUrl = "http://80.225.204.210:8090";

const SERVER_SCRIPT_NAME = "Temp Server Inspector";
const SERVER_SCRIPT_BODY = `
# Temp Server Inspector Script
import frappe
import os
import glob

out = []
try:
    # Let's search for python files in the custom app
    paths = glob.glob('/home/frappe/frappe-bench/apps/procurement_app/**/*.py', recursive=True)
    out.append("Found procurement_app paths: " + str(paths))
    for p in paths:
        with open(p, 'r') as f:
            content = f.read()
            if 'submit' in content or 'transfer' in content:
                out.append(f"File: {p}")
                # Print occurrences of submit or transfer
                lines = content.split('\\n')
                for idx, line in enumerate(lines):
                    if 'submit' in line or 'transfer' in line or 'make_stock_entry' in line:
                        out.append(f"  Line {idx+1}: {line}")
except Exception as e:
    out.append("Error: " + str(e))

frappe.response['message'] = out
`.trim();

async function run() {
  // 1. Create Server Script
  console.log("Creating temporary Server Script...");
  const createRes = await fetch(`${baseUrl}/api/resource/Server Script`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${apiKey}:${apiSecret}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      doctype: 'Server Script',
      name: SERVER_SCRIPT_NAME,
      script_type: 'API',
      api_method: 'temp_server_inspector',
      script: SERVER_SCRIPT_BODY,
      disabled: 0
    })
  });

  if (!createRes.ok) {
    console.error("Failed to create Server Script:", await createRes.text());
    return;
  }
  console.log("Server Script created successfully.");

  // 2. Call Server Script API
  console.log("Calling Server Script API...");
  try {
    const callRes = await fetch(`${baseUrl}/api/method/temp_server_inspector`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${apiKey}:${apiSecret}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    console.log("API Status:", callRes.status);
    const data = await callRes.json();
    console.log("API Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error calling API:", err);
  } finally {
    // 3. Delete Server Script
    console.log("Cleaning up Server Script...");
    const deleteRes = await fetch(`${baseUrl}/api/resource/Server Script/${encodeURIComponent(SERVER_SCRIPT_NAME)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${apiKey}:${apiSecret}`,
        'Accept': 'application/json'
      }
    });
    console.log("Cleanup status:", deleteRes.status);
  }
}

run().catch(console.error);
