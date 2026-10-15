import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({post:vi.fn()}));
vi.mock("./erpnext",()=>({apiGet:vi.fn(),apiPost:mocks.post,withoutNetworkRetry:()=>({_disableNetworkRetry:true})}));
vi.mock("../utils/accessToken",()=>({readErpProxyAccessToken:()=>"test-session",readSupplierAccessToken:()=>null}));
import {recordRfqAwardDecision} from "./clm";
const input={rfq:"RFQ-1",award_id:"AWARD-1",supplier_id:"SUP-1",quotation_id:"SQ-1"};
function result(decision:"Yes"|"No"="Yes") {return {created:decision==="Yes",...(decision==="Yes"?{request:{doctype:"Contract Request",record:{name:"CR-1",custom_rfq:"RFQ-1",supplier:"SUP-1",custom_supplier_quotation:"SQ-1"}}}:{}),summary:{rfq:{name:"RFQ-1"},decision,eligible:true,contract_required:decision,source:{award:"AWARD-1",supplier:"SUP-1",quotation:"SQ-1"},...(decision==="Yes"?{request:{name:"CR-1"}}:{})}};}
describe("award-only CLM client transaction",()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
  it.each(["Yes","No"] as const)("applies saved %s using only persisted award identity and no new decision payload",async decision=>{
    const value=result(decision);mocks.post.mockResolvedValue({data:value});
    expect(await recordRfqAwardDecision(input)).toEqual(value);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/clm?view=rfq_award_decision",input,{_disableNetworkRetry:true,_preserveResponse:true});
  });
  it("accepts the existing Request idempotently without claiming another creation",async()=>{
    const value={...result(),created:false};mocks.post.mockResolvedValue(value);expect((await recordRfqAwardDecision(input)).created).toBe(false);
  });
  it.each(["rfq","award_id","supplier_id","quotation_id"] as const)("requires saved %s before making any request",async field=>{
    await expect(recordRfqAwardDecision({...input,[field]:""})).rejects.toThrow("saved supplier award");expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(["award","supplier","quotation"] as const)("rejects a different saved %s",async field=>{
    const value=result();value.summary.source[field]="OTHER";mocks.post.mockResolvedValue(value);await expect(recordRfqAwardDecision(input)).rejects.toThrow("did not confirm the saved decision");
  });
  it("rejects Yes without an actual persisted Request",async()=>{
    mocks.post.mockResolvedValue({...result(),request:undefined});await expect(recordRfqAwardDecision(input)).rejects.toThrow("persisted award-linked Contract Request");
  });
  it("rejects No that incorrectly created a Request",async()=>{
    mocks.post.mockResolvedValue({...result("No"),request:result().request});await expect(recordRfqAwardDecision(input)).rejects.toThrow("skipped CLM");
  });
  it("does not forward an extra client choice that could overwrite the saved RFQ requirement",async()=>{
    mocks.post.mockResolvedValue(result("Yes"));
    const staleInput = { ...input, decision: "No" as const };
    expect((await recordRfqAwardDecision(staleInput)).summary.decision).toBe("Yes");
    expect(mocks.post.mock.calls[0][1]).toEqual(input);
  });
  it.each([{eligible:false},{recovery_required:true},{decision:"Pending"},{contract_required:"No"}])("rejects an unconfirmed handoff %j",async invalid=>{
    const value=result(); mocks.post.mockResolvedValue({...value,summary:{...value.summary,...invalid}});
    await expect(recordRfqAwardDecision(input)).rejects.toThrow("did not confirm the saved decision");
  });
  it("preserves actionable ERP transaction errors and never retries automatically",async()=>{
    mocks.post.mockResolvedValue({success:false,message:"Department is missing on the saved award"});await expect(recordRfqAwardDecision(input)).rejects.toThrow("Department is missing");expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
