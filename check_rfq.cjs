const http = require('http');
const { createHmac } = require('crypto');

function sessionSecret() {
  return (
    process.env.BIDSPHERE_SESSION_SECRET ||
    process.env.ERP_API_SECRET ||
    process.env.VITE_API_SECRET ||
    "bidsphere-dev-session-secret"
  );
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(payloadB64) {
  return createHmac("sha256", sessionSecret()).update(payloadB64).digest("base64url");
}

function issueToken(role = "admin") {
  const now = Date.now();
  const payload = {
    typ: "internal",
    sub: "admin@netlink.com",
    email: "admin@netlink.com",
    role,
    iat: now,
    exp: now + 3600000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

const token = issueToken("admin");

async function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:5175' + path, {
      headers: {
        'x-bidsphere-access-token': token
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
  });
}

(async () => {
  try {
    const summary = await get('/api/clm?view=rfq_contract&rfq=PUR-RFQ-2026-00107');
    console.log('RFQ CLM Summary:', JSON.stringify(summary, null, 2));

    const requests = await get('/api/clm?view=list&doctype=Contract%20Request');
    console.log('All Contract Requests count:', requests?.data?.records?.length);
    const rfqRequests = requests?.data?.records?.filter(r => r.custom_rfq === 'PUR-RFQ-2026-00107');
    console.log('Contract Requests for PUR-RFQ-2026-00107:', rfqRequests);

    const contracts = await get('/api/clm?view=list&doctype=Contract');
    console.log('All Contracts count:', contracts?.data?.records?.length);
    const rfqContracts = contracts?.data?.records?.filter(r => r.custom_rfq === 'PUR-RFQ-2026-00107');
    console.log('Contracts for PUR-RFQ-2026-00107:', rfqContracts);
  } catch (err) {
    console.error(err);
  }
})();
