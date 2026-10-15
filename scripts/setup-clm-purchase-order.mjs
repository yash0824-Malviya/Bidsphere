import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadClmPoSchema, planClmPoSchema, applyClmPoSchema } from './clm-purchase-order-schema.mjs';
const args = process.argv.slice(2);
if (args.length>1 || args.some(arg=>!['--check','--apply'].includes(arg))) throw new Error('Use --check (default) or --apply.');
const api = createEcrSchemaErpClient();
const before = await loadClmPoSchema(api), plan = planClmPoSchema(before);
if (args.includes('--apply') && plan.operations.length) {
  const directory = fileURLToPath(new URL(`../scratch/clm-po-schema-${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url));
  mkdirSync(directory,{recursive:true});
  writeFileSync(`${directory}/before.json`,JSON.stringify({before,plan},null,2),{flag:'wx',flush:true});
  const { after, ...result } = await applyClmPoSchema(api,before);
  writeFileSync(`${directory}/after.json`,JSON.stringify(after,null,2),{flag:'wx',flush:true});
  console.log(JSON.stringify({mode:'apply',...result,backup:directory},null,2));
} else console.log(JSON.stringify({mode:'check',...plan,ready:!plan.operations.length},null,2));
