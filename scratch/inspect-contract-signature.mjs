import { createEcrSchemaErpClient, ecrSchemaResource as resource } from '../scripts/ecr-schema-erp-client.mjs';
import { writeFileSync } from 'node:fs';
const api = createEcrSchemaErpClient();
const contract = await api('GET', resource('Contract', 'CON-2026-00001'));
const data = JSON.parse(contract.custom_clm_data || '{}');
const result = {
  checked_at: new Date().toISOString(), mode: 'read-only ERPNext inspection',
  contract: Object.fromEntries(['name','modified','docstatus','custom_contract_status','custom_esign_status','custom_final_version_locked','custom_current_version','custom_inteva_signatory','custom_supplier_signatory','custom_supplier','party_name','custom_rfq','custom_supplier_quotation','custom_contract_value','custom_currency','start_date','end_date'].map(key=>[key,contract[key]])),
  phase: data.rfq_workflow, approvals: data.approvals,
  signatures: data.signatures, locked_file: data.locked_file,
  locked_hash_present: !!data.locked_hash,
  audit: (data.audit || []).map(({action,by,at,previous_status,new_status})=>({action,by,at,previous_status,new_status})),
  award: data.rfq_context?.award_id || data.rfq_source?.award || data.rfq_source?.legal_review,
};
writeFileSync('scratch/contract-signature-before.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
