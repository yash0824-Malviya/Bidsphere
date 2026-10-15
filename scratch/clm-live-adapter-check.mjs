import{createServer}from'vite';
import{createEcrSchemaErpClient}from'../scripts/ecr-schema-erp-client.mjs';
createEcrSchemaErpClient();
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const erp=await server.ssrLoadModule('/api/clmErp.ts');
 const core=await server.ssrLoadModule('/api/clmCore.ts');
 for(const type of ['Contract','Contract Request','Contract Clause','Contract Approval Matrix','Contract Renewal','Contract Amendment','Contract Risk','Contract Milestone','Contract Obligation','Contract Template']) {
  const fields=await erp.getClmFields(type);
  const missing=core.clmEditableFields(type).filter(name=>!['clause_ids','non_standard_clause'].includes(name)&&!fields.some(row=>row.fieldname===name));
  const records=await erp.listClmErp(type);
  console.log(JSON.stringify({doctype:type,fields:fields.length,records:records.length,missingEditableFields:missing}));
 }
} finally {await server.close();}
