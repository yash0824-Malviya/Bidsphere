async function run() {
  const res = await fetch("http://localhost:5175/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usr: "legal@netlink.com",
      pwd: "Netlink@2026",
      requested_portal: "staff",
    }),
  });

  const json = await res.json();
  console.log("Login Status:", res.status);
  console.log("Login Response:", {
    name: json.name,
    email: json.email,
    role: json.role,
    hasToken: Boolean(json.access_token),
    tokenPreview: json.access_token?.slice(0, 50),
    erpRoles: json.erpnext_roles?.filter(r => r.includes("Legal")),
  });
}

run().catch(console.error);
