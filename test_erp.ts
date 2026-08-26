import { erpnext, buildResourceUrl } from './src/api/erpnext.ts';

async function main() {
  try {
    const res = await erpnext.get('/api/resource/Business Need');
    console.log('Business Needs in ERPNext:', JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error('Error fetching:', e.response?.data || e.message);
  }
}
main();
