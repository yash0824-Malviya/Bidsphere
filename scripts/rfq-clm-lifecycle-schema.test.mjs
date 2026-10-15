import { describe, expect, it } from 'vitest';
import { planRfqClmLifecycleSchema, verifyRfqClmLifecycleMigration, RFQ_CLM_AWARD_STATE } from './rfq-clm-lifecycle-schema.mjs';

const dt = RFQ_CLM_AWARD_STATE.dt;
const fixture = () => ({ doctypes: { [dt]: { name: dt, fields: [{fieldname:'review_status',fieldtype:'Select',options:'Pending\nApproved\nRejected'}], permissions:[{role:'Legal Manager',read:1}] } }, customFields:[], propertySetters:[], customPermissions:[], roles:[{name:'Legal Manager'}], workflows:[{name:'Existing RFQ Legal Review'}], records:{[dt]:[{name:'LDC-old',review_status:'Approved',modified:'same'}]} });
const applyFixture = (before, plan) => {
  const after = structuredClone(before);
  for (const row of plan.operations) {
    if (row.kind === 'create-custom-field') after.customFields.push({...row.document,name:`${dt}-${row.document.fieldname}`});
    else if (row.kind === 'update-custom-field') Object.assign(after.customFields.find(field=>field.name===row.name),row.patch);
    else if (row.kind === 'update-property-setter') Object.assign(after.propertySetters.find(setter=>setter.name===row.name),row.patch);
    else if (row.kind === 'create-property-setter') after.propertySetters.push({...row.document,name:`setter-${row.document.property}`});
    else throw new Error(row.kind);
  }
  return after;
};

describe('RFQ CLM award lifecycle schema', () => {
  it('adds one default-empty optional server-managed field without migrating records or workflow states', () => {
    const before=fixture(); const copy=structuredClone(before); const plan=planRfqClmLifecycleSchema(before);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({kind:'create-custom-field',doctype:dt,document:{fieldname:'custom_clm_state',fieldtype:'Long Text',reqd:0,default:'',read_only:1,hidden:1,no_copy:1,allow_on_submit:1}});
    expect(plan).toMatchObject({recordMigration:false,workflowChanges:false,permissionChanges:false,newDoctypes:[],newRoles:[]});
    expect(before).toEqual(copy);
    const after=applyFixture(before,plan); after.records[dt][0].custom_clm_state=null;
    expect(verifyRfqClmLifecycleMigration(before,after,plan)).toMatchObject({verified:true,recordsPreserved:1});
    expect(planRfqClmLifecycleSchema(after).operations).toEqual([]);
  });
  it.each(['clm_state','custom_clm_data'])('refuses duplicate schema when equivalent %s exists', fieldname => {
    const before=fixture(); before.customFields.push({dt,fieldname,fieldtype:'Long Text'});
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/no duplicate field/);
  });
  it('detects equivalent labels and ambiguous fields', () => {
    const before=fixture(); before.customFields.push({dt,fieldname:'legacy_state',label:'Contract Lifecycle State',fieldtype:'Long Text'});
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/no duplicate field/);
    before.customFields.push({dt,fieldname:'custom_clm_state',fieldtype:'Long Text'});
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/Multiple fields/);
  });
  it('retains existing evidence and protects an already-established field', () => {
    const before=fixture(); before.customFields.push({dt,name:'existing',fieldname:'custom_clm_state',fieldtype:'Long Text',modified:'stamp'}); before.records[dt][0].custom_clm_state='{"contract_status":"Executed"}';
    const plan=planRfqClmLifecycleSchema(before);
    expect(plan.operations).toEqual([{kind:'update-custom-field',doctype:dt,name:'existing',modified:'stamp',patch:{read_only:1,hidden:1,no_copy:1,allow_on_submit:1}}]);
    expect(verifyRfqClmLifecycleMigration(before,applyFixture(before,plan),plan).verified).toBe(true);
  });
  it('respects effective Property Setter values', () => {
    const before=applyFixture(fixture(),planRfqClmLifecycleSchema(fixture()));
    before.propertySetters.push({name:'override',doc_type:dt,field_name:'custom_clm_state',property:'read_only',value:'0',modified:'setter-stamp'});
    const plan=planRfqClmLifecycleSchema(before);
    expect(plan.operations).toEqual([{kind:'update-property-setter',doctype:dt,name:'override',modified:'setter-stamp',patch:{value:'1'}}]);
    expect(verifyRfqClmLifecycleMigration(before,applyFixture(before,plan),plan).verified).toBe(true);
  });
  it('refuses incompatible type, lifecycle defaults and mandatory fields', () => {
    const before=fixture(); before.customFields.push({dt,fieldname:'custom_clm_state',fieldtype:'Data'});
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/expected Long Text/);
    before.customFields[0].fieldtype='Long Text'; before.customFields[0].default='Draft';
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/optional and default-empty/);
    before.customFields[0].default=''; before.customFields[0].reqd=1;
    expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/optional and default-empty/);
  });
  it('refuses missing award DocType', () => {
    const before=fixture(); before.doctypes={}; expect(()=>planRfqClmLifecycleSchema(before)).toThrow(/no DocType/);
  });
  it.each(['roles','workflows','customPermissions'])('detects unrelated %s changes', key => {
    const before=fixture(); const plan=planRfqClmLifecycleSchema(before); const after=applyFixture(before,plan); after[key].push({unexpected:true});
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(new RegExp(`${key} changed`));
  });
  it('rejects accidental workflow status edits or populated lifecycle data during field creation', () => {
    const before=fixture(); const plan=planRfqClmLifecycleSchema(before); const after=applyFixture(before,plan); after.records[dt][0].review_status='Pending';
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(/records changed/);
    after.records[dt][0].review_status='Approved'; after.records[dt][0].custom_clm_state='{}';
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(/acquired lifecycle data/);
  });
  it('detects unrelated schema and permissions changes', () => {
    const before=fixture(); const plan=planRfqClmLifecycleSchema(before); let after=applyFixture(before,plan); after.doctypes[dt].fields[0].options+='\nCompleted';
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(/DocType fields changed/);
    after=applyFixture(before,plan); after.doctypes[dt].permissions[0].write=1;
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(/permissions changed/);
    after=applyFixture(before,plan); after.customFields.push({fieldname:'unrelated'});
    expect(()=>verifyRfqClmLifecycleMigration(before,after,plan)).toThrow(/Unrelated Custom Fields/);
  });
});
