import {isValidElement,type ReactNode,type ReactElement} from "react";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const hooks=vi.hoisted(()=>({cursor:0,values:[] as unknown[]}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  } };
});
vi.mock("react-dom",()=>({createPortal:(node:ReactNode)=>node}));
vi.mock("../contexts/LayoutContext",()=>({useOptionalLayout:()=>null}));
vi.mock("./contracts/ClmFields",()=>({ClmLinkInput:()=>null}));
import {SelectionConfirmDialog} from "./AIAnalysisModal";
import RfqContractRequirementField from "./sourcing/RfqContractRequirementField";
import type {SupplierAnalysisRow} from "../types/erpnext";
type Node=ReactElement<Record<string,any>>;
function nodes(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(nodes);if(!isValidElement(node))return[];const value=node as Node;return[value,...nodes(value.props.children)];}
function text(node:ReactNode):string{if(typeof node==="string")return node;if(Array.isArray(node))return node.map(text).join("");return isValidElement(node)?text((node as Node).props.children):"";}
const supplier={name:"Awarded supplier",rank:1,rfq_id:"RFQ-1",supplier_id:"SUP-1",quotation_id:"SQ-1",evaluation_status:"complete",evaluation_run_id:"EVAL-1",quote_price_status:"submitted",grand_total:48500,risk:"Low",verdict:"GOOD OPTION",score:{overall:90,cost:90,delivery:90,quality:90,reliability:90},strengths:[],weaknesses:[],why_best_or_worst:"Best total value"} as SupplierAnalysisRow;
describe("supplier award confirmation decision",()=>{
  beforeEach(()=>{hooks.cursor=0;hooks.values=[];vi.stubGlobal("document",{body:{}});});afterEach(()=>vi.unstubAllGlobals());
  function render(confirm=vi.fn(),busy=false){hooks.cursor=0;return SelectionConfirmDialog({supplier,isTopPick:true,onConfirm:confirm,onCancel:vi.fn(),busy});}
  function button(tree:ReactNode){return nodes(tree).find(node=>node.type==="button"&&text(node)==="Confirm Award")!;}
  it("requires the existing selection reason without asking the RFQ contract choice again",()=>{
    const confirm=vi.fn();const tree=render(confirm);
    expect(nodes(tree).some(node=>node.type===RfqContractRequirementField)).toBe(false);
    expect(text(tree)).not.toContain("Contract Required");
    expect(button(tree).props.disabled).toBe(true);button(tree).props.onClick();expect(confirm).not.toHaveBeenCalled();
  });
  it("passes the unchanged selection rationale without a new contract decision",()=>{
    const confirm=vi.fn();let tree=render(confirm);nodes(tree).find(node=>node.type==="textarea")!.props.onChange({target:{value:"Business rationale"}});tree=render(confirm);
    expect(button(tree).props.disabled).toBe(false);button(tree).props.onClick();expect(confirm).toHaveBeenCalledExactlyOnceWith("Business rationale");
  });
  it("keeps the entered reason while a save is busy",()=>{
    let tree=render();nodes(tree).find(node=>node.type==="textarea")!.props.onChange({target:{value:"Keep rationale"}});tree=render(vi.fn(),true);
    expect(button(tree).props.disabled).toBe(true);expect(nodes(tree).some(node=>node.type===RfqContractRequirementField)).toBe(false);expect(nodes(tree).find(node=>node.type==="textarea")!.props.value).toBe("Keep rationale");
  });
});
