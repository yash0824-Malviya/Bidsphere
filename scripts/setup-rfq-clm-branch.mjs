/** Read only by default; only enables the existing contract_required field after submission. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEcrSchemaErpClient } from './ecr-schema-erp-client.mjs';
import { loadRfqContractSchema, planRfqContractSchema, applyRfqContractSchemaPlan } from './rfq-contract-schema.mjs';
import { resolveClmField } from './clm-schema.mjs';

const descriptor = { dt: 'Request for Quotation', fieldname: 'contract_required', label: 'Does this RFQ require a Contract?', fieldtype: 'Select', aliases: ['custom_contract_required', 'requires_contract', 'custom_requires_contract'], equivalentLabels: ['Contract Required', 'Contract Requirement', 'Requires Contract'] };

export function planRfqClmBranchSchema(snapshot) {
  const base = planRfqContractSchema(snapshot);
  if (base.operations.length) throw new Error('Apply the existing RFQ Contract schema setup first; this branch migration creates no fields.');
  const found = resolveClmField(snapshot, descriptor);
  if (!found || found.fieldname !== 'contract_required') throw new Error('The established contract_required field must exist. No duplicate or renamed field will be created.');
  const operations = [];
  if (Number(found.allow_on_submit) !== 1) {
    const setter = snapshot.propertySetters.find(row => row.doc_type === descriptor.dt && row.field_name === found.fieldname && row.property === 'allow_on_submit');
    if (setter) operations.push({ kind: 'update-property-setter', doctype: descriptor.dt, name: setter.name, modified: setter.modified, patch: { value: '1' } });
    else if (found.source === 'custom') operations.push({ kind: 'update-custom-field', doctype: descriptor.dt, name: found.name, modified: found.modified, patch: { allow_on_submit: 1 } });
    else operations.push({ kind: 'create-property-setter', doctype: descriptor.dt, document: { doctype_or_field: 'DocField', doc_type: descriptor.dt, field_name: found.fieldname, property: 'allow_on_submit', property_type: 'Check', value: '1' } });
  }
  return { operations, recordMigration: false, workflowChanges: false, permissionChanges: false, newDoctypes: [], newRoles: [], bindings: base.bindings };
}

export function verifyRfqClmBranchSchema(before, after) {
  for (const key of ['records', 'roles', 'workflows', 'customPermissions']) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`${key} changed during RFQ CLM schema migration.`);
  for (const dt of Object.keys(before.doctypes)) if (JSON.stringify(before.doctypes[dt].permissions) !== JSON.stringify(after.doctypes[dt].permissions)) throw new Error(`${dt} permissions changed.`);
  if (planRfqClmBranchSchema(after).operations.length) throw new Error('RFQ CLM schema verification is incomplete.');
  return { verified: true, recordsPreserved: true, rolesPreserved: true, workflowsPreserved: true, permissionsPreserved: true };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Use --check (default) or --apply.');
  const api = createEcrSchemaErpClient();
  const before = await loadRfqContractSchema(api);
  const plan = planRfqClmBranchSchema(before);
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'check', ...plan }, null, 2));
  if (!args.includes('--apply') || !plan.operations.length) return;
  const directory = fileURLToPath(new URL(`../scratch/rfq-clm-branch-schema-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/before.json`, JSON.stringify({ snapshot: before, plan }, null, 2), { flag: 'wx' });
  await applyRfqContractSchemaPlan(api, before, plan);
  const after = await loadRfqContractSchema(api);
  writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(verifyRfqClmBranchSchema(before, after), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
