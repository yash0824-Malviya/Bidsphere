/** Read-only by default. Usage: node scripts/setup-clm.mjs [--check | --apply] */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEcrSchemaErpClient, listAllEcrSchemaRows, ecrSchemaResource as resource } from './ecr-schema-erp-client.mjs';
import { loadClmSchema, planClmSchema, applyClmSchemaPlan } from './clm-schema.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Saving a custom DocType refreshes child-row timestamps even when every
// permission flag is preserved. Compare the complete permission definition.
const permissionDefinition = rows => rows.map(({ modified, modified_by, ...definition }) => definition);
async function allWorkflows(api) {
  const records = []; for (const row of await listAllEcrSchemaRows(api, 'Workflow', ['name'])) records.push(await api('GET', resource('Workflow', row.name))); return records;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (read only, default) or --apply.');
  const api = createEcrSchemaErpClient();
  const before = await loadClmSchema(api);
  const plan = planClmSchema(before);
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'check', ...plan }, null, 2));
  if (!args.includes('--apply') || !plan.operations.length) return;

  const workflows = await allWorkflows(api);
  const backupDirectory = fileURLToPath(new URL(`../scratch/clm-migration-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(backupDirectory, { recursive: true });
  // Includes original field/permission/workflow definitions and complete existing CLM records.
  writeFileSync(`${backupDirectory}/before.json`, JSON.stringify({ schema: before, workflows, plan }, null, 2), { flag: 'wx' });
  console.log(`Migration backup written: ${backupDirectory}`);
  await applyClmSchemaPlan(api, before, plan);
  const after = await loadClmSchema(api);
  const remaining = planClmSchema(after);
  if (remaining.operations.length) throw new Error('CLM schema readback is incomplete; inspect the backup and remaining plan before rollout.');
  if (fingerprint(before.records) !== fingerprint(after.records)) throw new Error('CLM records changed during migration; inspect before claiming verification.');
  if (fingerprint(before.customPermissions) !== fingerprint(after.customPermissions)) throw new Error('Custom permissions changed during migration.');
  for (const dt of Object.keys(before.doctypes)) if (fingerprint(permissionDefinition(before.doctypes[dt].permissions)) !== fingerprint(permissionDefinition(after.doctypes[dt].permissions))) throw new Error(`${dt} permissions changed during migration.`);
  const afterWorkflows = await allWorkflows(api);
  for (const original of workflows) if (fingerprint(original) !== fingerprint(afterWorkflows.find(row => row.name === original.name))) throw new Error(`Existing workflow ${original.name} changed during migration.`);
  const result = { verified: true, operations: plan.operations.length, existingRecordsUnchanged: Object.values(before.records).reduce((sum, rows) => sum + rows.length, 0), existingWorkflowsUnchanged: workflows.length, permissionsUnchanged: true, newDoctypes: 0, newRoles: 0, bindings: remaining.bindings };
  writeFileSync(`${backupDirectory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
