// Read-only diagnosis: existing ERP records, existing presentation predicates, no mutations.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from '../scripts/ecr-schema-erp-client.mjs';
import { getECRCurrentStage, getECRQueueSummary, isPendingApprovalForRole, matchesECRQueueFilter } from '../src/config/ecrQueues.ts';
import { formatECRNumber, isEcrOwnedBy } from '../src/config/ecrRoles.ts';
import { matchesVisibleQueueFilter } from '../src/pages/ecr/ecrListPresentation.ts';
import { getEngineeringECRMetrics } from '../src/pages/ecr/engineeringEcrMetrics.ts';

const api = createEcrSchemaErpClient();
const users = await listAllEcrSchemaRows(api, 'User', ['name', 'email', 'username', 'full_name'], [['full_name', '=', 'Engineering Manager']]);
if (users.length !== 1) throw new Error('Expected one Engineering Manager identity for this diagnostic.');
const user = { ...users[0], role: 'engineering' };
const list = await listAllEcrSchemaRows(api, 'Engineering Change Request', ['name']);
const rows = [];
for (const row of list) rows.push(await api('GET', resource('Engineering Change Request', row.name)));
const classifications = rows.map(ecr => ({
  id: formatECRNumber(ecr), name: ecr.name, ecr_workflow_version: ecr.ecr_workflow_version,
  owner: ecr.owner, ecr_owner: ecr.ecr_owner, created_by: ecr.created_by ?? null,
  creation_user: ecr.creation_user ?? null, amended_from: ecr.amended_from ?? null,
  assigned_to: ecr.assigned_to ?? ecr._assign ?? null,
  current_stage: ecr.current_stage ?? null, approval_status: ecr.approval_status ?? null,
  workflow_state: ecr.workflow_state ?? null, workflow_status: ecr.select_pxfp,
  normalized_status: getECRCurrentStage(ecr.select_pxfp, ecr),
  approval_tasks: ecr.approval_requirements?.map(row => ({ role: row.approval_role, required: row.required, status: row.status, approver: row.approver })),
  isMine: isEcrOwnedBy(ecr, user),
  isApprovedDashboardBefore: matchesECRQueueFilter('approved', 'engineering', ecr, user),
  isApprovedList: matchesVisibleQueueFilter('approved', 'engineering', ecr, user),
  isClosed: matchesVisibleQueueFilter('closed', 'engineering', ecr, user),
  isPendingApproval: isPendingApprovalForRole('engineering', ecr),
  isSentBack: matchesVisibleQueueFilter('sent-back', 'engineering', ecr, user),
}));
const result = {
  inspectedAt: new Date().toISOString(), mutations: 0,
  identityScope: 'Persisted Engineering Manager account; browser is currently Engineer',
  user, total: rows.length,
  dashboardBefore: getECRQueueSummary('engineering', rows, user),
  dashboardAfter: getEngineeringECRMetrics(rows, user),
  listCounts: Object.fromEntries(['all', 'mine', 'pending-approval', 'sent-back', 'approved', 'closed'].map(filter => [filter, rows.filter(ecr => matchesVisibleQueueFilter(filter, 'engineering', ecr, user)).length])),
  approvedDiscrepancy: classifications.filter(row => row.isApprovedDashboardBefore !== row.isApprovedList).map(row => row.id),
  records: classifications,
};
for (const [metric, filter] of Object.entries({ all: 'all', mine: 'mine', pending: 'pending-approval', sentBack: 'sent-back', approved: 'approved', closed: 'closed' })) {
  assert.equal(result.dashboardAfter[metric], result.listCounts[filter]);
}
writeFileSync(new URL('./engineering-metrics-live-inspection.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, records: undefined }, null, 2));
