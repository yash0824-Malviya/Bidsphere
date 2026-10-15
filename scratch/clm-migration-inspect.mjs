import {readFileSync,writeFileSync} from 'node:fs';
import {createEcrSchemaErpClient,ecrSchemaResource as resource} from '../scripts/ecr-schema-erp-client.mjs';
import {loadClmSchema,planClmSchema} from '../scripts/clm-schema.mjs';
const before=JSON.parse(readFileSync('scratch/clm-migration-2026-09-17T07-05-38-663Z/before.json','utf8'));
const api=createEcrSchemaErpClient();
const after=await loadClmSchema(api);
writeFileSync('scratch/clm-schema-after.json',JSON.stringify(after,null,2));
for (const dt of Object.keys(before.schema.doctypes)) {
 const a=before.schema.doctypes[dt].permissions,b=after.doctypes[dt].permissions;
 if(JSON.stringify(a)!==JSON.stringify(b)) console.log(JSON.stringify({doctype:dt,before:a,after:b}));
}
console.log(JSON.stringify({remaining:planClmSchema(after).operations.length}));
