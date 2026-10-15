/** Read-only by default: node scripts/setup-rfq-contract.mjs [--check | --apply]. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqContractSchema, planRfqContractSchema, applyRfqContractSchemaPlan, verifyRfqContractMigration } from './rfq-contract-schema.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (default, read only) or --apply.');
  const api = createEcrSchemaErpClient();
  const before = await loadRfqContractSchema(api);
  const plan = planRfqContractSchema(before);
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'check', ...plan }, null, 2));
  if (!args.includes('--apply') || !plan.operations.length) return;
  const dir = fileURLToPath(new URL(`../scratch/rfq-contract-migration-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/before.json`, JSON.stringify({ schema: before, plan }, null, 2), { flag: 'wx' });
  console.log(`Schema and complete record backup: ${dir}`);
  await applyRfqContractSchemaPlan(api, before, plan);
  const after = await loadRfqContractSchema(api);
  writeFileSync(`${dir}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx' });
  const result = verifyRfqContractMigration(before, after, plan);
  writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
