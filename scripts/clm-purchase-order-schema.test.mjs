import { describe,it,expect,vi } from 'vitest';
import { CLM_PO_FIELDS,planClmPoSchema,applyClmPoSchema } from './clm-purchase-order-schema.mjs';
const initial=()=>({schema:{name:'Purchase Order',fields:[{fieldname:'supplier',fieldtype:'Link',options:'Supplier'}]},custom:[],setters:[]});
describe('CLM optional standard PO links',()=>{
  it('adds only optional links and one unique retry key, without record or workflow migration',()=>{
    const plan=planClmPoSchema(initial());
    expect(plan.operations).toHaveLength(4);
    expect(plan.operations.every(row=>row.dt==='Purchase Order' && row.reqd===0 && row.read_only===1 && !row.default)).toBe(true);
    expect(plan.operations.filter(row=>row.unique).map(row=>row.fieldname)).toEqual(['custom_clm_creation_key']);
    expect(plan).toMatchObject({recordMigration:false,workflowChanges:false,permissionChanges:false});
  });
  it('reuses valid existing fields and refuses incompatible duplicates or overrides',()=>{
    expect(planClmPoSchema({...initial(),custom:CLM_PO_FIELDS}).operations).toEqual([]);
    for(const custom of [[{...CLM_PO_FIELDS[0],fieldtype:'Data'}],[{...CLM_PO_FIELDS[3],unique:0}],[{...CLM_PO_FIELDS[0],reqd:1}],[CLM_PO_FIELDS[0],CLM_PO_FIELDS[0]]]) expect(()=>planClmPoSchema({...initial(),custom})).toThrow();
    expect(()=>planClmPoSchema({...initial(),setters:[{field_name:'custom_clm_contract'}]})).toThrow();
  });
  it('uses only Custom Field creation and verifies readback; reruns are idempotent',async()=>{
    const snapshot=initial(); const state=initial();
    const api=vi.fn(async(method,path,body)=>{if(method==='POST'){state.custom.push(body);return body;} if(path==='resource/DocType/Purchase%20Order')return structuredClone(state.schema); if(path.startsWith('resource/Custom%20Field?'))return structuredClone(state.custom); if(path.startsWith('resource/Property%20Setter?'))return []; throw new Error(path);});
    expect((await applyClmPoSchema(api,snapshot)).verified).toBe(true);
    expect(api.mock.calls.filter(([method])=>method==='POST').every(([,path])=>path==='resource/Custom%20Field')).toBe(true);
    expect((await applyClmPoSchema(api,state)).created).toEqual([]);
  });
});
