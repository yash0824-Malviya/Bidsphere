import{createEcrSchemaErpClient,ecrSchemaResource as resource}from'../scripts/ecr-schema-erp-client.mjs';
const api=createEcrSchemaErpClient();
for(const [label,dt,params] of [
 ['role assignments','Has Role',{fields:JSON.stringify(['parent']),filters:JSON.stringify([['role','in',['Procurement Manager','Purchase Manager']]]),limit_page_length:'5'}],
 ['financial closure query','Purchase Invoice',{fields:JSON.stringify(['name']),filters:JSON.stringify([['Purchase Invoice Item','purchase_order','=','CLM-query-validation-only']]),limit_page_length:'5'}],
 ['supplier notification mapping','Supplier Onboarding',{fields:JSON.stringify(['name','portal_user','linked_supplier']),filters:JSON.stringify([['status','=','Approved']]),limit_page_length:'1'}]]) {
 try {const rows=await api('GET',resource(dt)+'?'+new URLSearchParams(params));console.log(JSON.stringify({label,success:true,count:rows.length}));}catch(error){console.log(JSON.stringify({label,success:false,message:error.message}));}
}
