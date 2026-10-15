/** Read-only by default. No app installation, Bench, record migration or replacement DocTypes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqClmInitialRequestSchema, planRfqClmInitialRequestSchema, applyRfqClmInitialRequestSchemaPlan, verifyRfqClmInitialRequestSchema } from './rfq-clm-initial-request-schema.mjs';

export async function runRfqClmInitialRequestSchema(api, { apply = false, gatewayValidationConfirmed = false, saveBackup, saveAfter = async () => {} } = {}) {
  const before = await loadRfqClmInitialRequestSchema(api);
  const plan = planRfqClmInitialRequestSchema(before);
  if (!apply || !plan.operations.length) return { mode: apply ? 'apply' : 'check', ...plan, applied: false };
  if (!gatewayValidationConfirmed) throw new Error(plan.validationNotice);
  if (typeof saveBackup !== 'function') throw new Error('A complete, durable before-backup is required before applying the initial Request metadata change.');
  await saveBackup({ snapshot: before, plan });
  await applyRfqClmInitialRequestSchemaPlan(api, before, plan, { gatewayValidationConfirmed });
  const after = await loadRfqClmInitialRequestSchema(api);
  await saveAfter(after);
  return { mode: 'apply', ...plan, ...verifyRfqClmInitialRequestSchema(before, after, plan), applied: true };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--apply', '--gateway-validation-confirmed'].includes(arg)) || (args.includes('--check') && args.includes('--apply'))) throw new Error('Use --check, or --apply --gateway-validation-confirmed after reviewing the mandatory-field validation limitation.');
  const api = createEcrSchemaErpClient();
  let directory;
  const result = await runRfqClmInitialRequestSchema(api, {
    apply: args.includes('--apply'), gatewayValidationConfirmed: args.includes('--gateway-validation-confirmed'),
    saveBackup: async backup => {
      directory = fileURLToPath(new URL(`../scratch/rfq-clm-initial-request-schema-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/before.json`, JSON.stringify(backup, null, 2), { flag: 'wx', flush: true });
    },
    saveAfter: async after => writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx', flush: true }),
  });
  if (directory) writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx', flush: true });
  console.log(JSON.stringify({ ...result, ...(directory ? { backup: directory } : {}) }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
