const http = require('http');

async function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5175' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const reviews = await get('/api/method/frappe.client.get_list?doctype=Legal%20Document%20Review&filters=' + 
    encodeURIComponent(JSON.stringify([["rfq_name", "=", "PUR-RFQ-2026-00107"]])) + 
    '&fields=' + encodeURIComponent(JSON.stringify(["*"])));
  console.log('Legal Document Reviews:', reviews);
})();
