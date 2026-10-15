/** REST-only prerequisite update. Read-only --check is the default. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqClmRestSchema, planRfqClmRestSchema, applyRfqClmRestSchemaPlan, verifyRfqClmRestSchema } from './rfq-clm-rest-schema.mjs';

export async function runRfqClmRestSchema(api, { apply = false, saveBackup, saveAfter = async () => {} } = {}) {
  const before = await loadRfqClmRestSchema(api);
  const plan = planRfqClmRestSchema(before);
  if (!apply || !plan.operations.length) return { mode: apply ? 'apply' : 'check', ...plan, applied: false };
  if (typeof saveBackup !== 'function') throw new Error('A complete, durable before-backup is required before --apply.');
  await saveBackup({ snapshot: before, plan });
  await applyRfqClmRestSchemaPlan(api, before, plan);
  const after = await loadRfqClmRestSchema(api);
  await saveAfter(after);
  return { mode: 'apply', ...plan, ...verifyRfqClmRestSchema(before, after, plan), applied: true };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (default, read only) or --apply.');
  const api = createEcrSchemaErpClient();
  let directory;
  const result = await runRfqClmRestSchema(api, {
    apply: args.includes('--apply'),
    saveBackup: async backup => {
      directory = fileURLToPath(new URL(`../scratch/rfq-clm-rest-schema-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/before.json`, JSON.stringify(backup, null, 2), { flag: 'wx', flush: true });
      console.log(JSON.stringify({ backup: directory, plannedOperations: backup.plan.operations }));
    },
    saveAfter: async after => writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx' }),
  });
  if (directory) writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, ...(directory ? { backup: directory } : {}) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
