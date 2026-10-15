/** Read-only by default: node scripts/setup-rfq-award-contract.mjs [--check | --apply]. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqAwardContractSchema, planRfqAwardContractSchema, applyRfqAwardContractSchemaPlan, verifyRfqAwardContractMigration } from './rfq-award-contract-schema.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (default, read only) or --apply.');
  const api = createEcrSchemaErpClient();
  const before = await loadRfqAwardContractSchema(api);
  const plan = planRfqAwardContractSchema(before);
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'check', ...plan }, null, 2));
  if (!args.includes('--apply') || !plan.operations.length) return;
  const directory = fileURLToPath(new URL(`../scratch/rfq-award-contract-migration-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/before.json`, JSON.stringify({ schema: before, plan }, null, 2), { flag: 'wx' });
  console.log(`Schema and record backup: ${directory}`);
  await applyRfqAwardContractSchemaPlan(api, before, plan);
  const after = await loadRfqAwardContractSchema(api);
  writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx' });
  const result = verifyRfqAwardContractMigration(before, after, plan);
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
