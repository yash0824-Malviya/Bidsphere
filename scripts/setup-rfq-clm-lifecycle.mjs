/** Read-only by default; adds only the optional award CLM lifecycle evidence field. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqClmLifecycleSchema, planRfqClmLifecycleSchema, applyRfqClmLifecycleSchemaPlan, verifyRfqClmLifecycleMigration } from './rfq-clm-lifecycle-schema.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (default, read only) or --apply.');
  const api = createEcrSchemaErpClient();
  const before = await loadRfqClmLifecycleSchema(api);
  const plan = planRfqClmLifecycleSchema(before);
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'check', ...plan }, null, 2));
  if (!args.includes('--apply') || !plan.operations.length) return;
  const directory = fileURLToPath(new URL(`../scratch/rfq-clm-lifecycle-schema-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/before.json`, JSON.stringify({ snapshot: before, plan }, null, 2), { flag: 'wx' });
  await applyRfqClmLifecycleSchemaPlan(api, before, plan);
  const after = await loadRfqClmLifecycleSchema(api);
  writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx' });
  const result = verifyRfqClmLifecycleMigration(before, after, plan);
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, backup: directory }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
