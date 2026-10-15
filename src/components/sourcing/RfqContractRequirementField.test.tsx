import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RfqContractRequirementField from "./RfqContractRequirementField";
vi.mock("../contracts/ClmFields", () => ({ ClmLinkInput: ({ doctype, value, required, disabled, id, invalid }: { doctype: string; value: string; required?: boolean; disabled?: boolean; id?: string; invalid?: boolean }) => <input id={id} aria-label={doctype} value={value} required={required} disabled={disabled} aria-invalid={invalid || undefined} readOnly /> }));

describe("RFQ Contract Requirement", () => {
  it("shows No first and the requested award-only helper", () => {
    const html = renderToStaticMarkup(<RfqContractRequirementField value="No" onChange={vi.fn()} />);
    expect(html).toContain("Will this RFQ require a Contract?");
    expect(html).toMatch(/checked=""[^>]*value="No"/);
    expect(html.indexOf('value="No"')).toBeLessThan(html.indexOf('value="Yes"'));
    expect(html).toContain("If Yes, the CLM workflow will start after the supplier is awarded. No Contract Request is created before supplier award.");
    expect(html).not.toContain("Create Contract Request");
  });
  it("distinguishes saved draft metadata from the later award-time Request", () => {
    const html = renderToStaticMarkup(<RfqContractRequirementField value="Yes" onChange={vi.fn()} />);
    expect(html).toMatch(/checked=""[^>]*value="Yes"/);
    expect(html).toContain("If Yes, the CLM workflow will start after the supplier is awarded.");
    expect(html).toContain("No Contract Request is created before supplier award.");
    expect(html).not.toContain("Saving this RFQ creates");
    expect(html).not.toContain("Submitting the RFQ creates");
  });
  it("starts with neither choice selected and marks the choice required", () => {
    const html = renderToStaticMarkup(<RfqContractRequirementField value="" onChange={vi.fn()} />);
    expect(html).not.toContain('checked=""'); expect(html.match(/required=""/g)).toHaveLength(2);
    expect(html).toContain('aria-required="true"'); expect(html).toContain("Contract Required? *");
  });
  it("disables both choices while the RFQ is saving", () => {
    const html = renderToStaticMarkup(<RfqContractRequirementField value="No" onChange={vi.fn()} disabled />);
    expect(html).toContain('<fieldset disabled=""');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
  });
  it("asks for a Department only for Yes when no source Department is supplied", () => {
    const department = { value: "Production - N", onChange: vi.fn() };
    const yes = renderToStaticMarkup(<RfqContractRequirementField value="Yes" onChange={vi.fn()} department={department} />);
    expect(yes).toContain("Department *"); expect(yes).toContain('value="Production - N"'); expect(yes).toContain('required=""');
    const no = renderToStaticMarkup(<RfqContractRequirementField value="No" onChange={vi.fn()} department={department} />);
    expect(no).not.toContain("Department *");
    const inherited = renderToStaticMarkup(<RfqContractRequirementField value="Yes" onChange={vi.fn()} />);
    expect(inherited).not.toContain("Department *");
  });
  it("keeps Department lookup errors visible and the control disabled during save", () => {
    const html = renderToStaticMarkup(<RfqContractRequirementField value="Yes" onChange={vi.fn()} disabled department={{ value: "Unknown", onChange: vi.fn(), error: "Select an existing Department." }} />);
    expect(html).toContain('aria-invalid="true"'); expect(html).toContain('role="alert"'); expect(html).toContain("Select an existing Department.");
    expect(html).toMatch(/aria-label="Department"[^>]*disabled=""/);
  });
});
