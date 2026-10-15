import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ClmAlerts from "./ClmAlerts";
import type { ClmAlert } from "../../api/clm";

const alert = (number: number): ClmAlert => ({ id: `alert-${number}`, kind: "obligation_overdue", severity: "warning", message: `Obligation ${number} needs action.`, contract: `CON-${number}`, source_doctype: "Contract Obligation", source_name: `OBL-${number}`, due_date: "2026-09-10", owner: "assigned@example.test" });
const render = (alerts: ClmAlert[]) => renderToStaticMarkup(<MemoryRouter><ClmAlerts alerts={alerts} /></MemoryRouter>);
describe("Contract alert panel", () => {
  it("does not add an empty notification panel", () => { expect(render([])).toBe(""); });
  it("shows the first ten alerts with a view-all control", () => {
    const html = render(Array.from({ length: 14 }, (_, index) => alert(index + 1)));
    expect(html).toContain("Obligation 10 needs action."); expect(html).not.toContain("Obligation 11 needs action.");
    expect(html).toContain("View all 14 alerts"); expect(html).toContain('aria-expanded="false"');
  });
  it("links to the parent contract with encoded identifiers and displays due-date ownership", () => {
    const html = render([{ ...alert(1), contract: "CON one/2026" }]);
    expect(html).toContain('href="/contracts/CON%20one%2F2026"'); expect(html).toContain("Due: 2026-09-10"); expect(html).toContain("assigned@example.test");
    expect(html).not.toContain("/contracts/settings");
  });
  it("escapes saved alert text", () => {
    const html = render([{ ...alert(1), message: '<script>alert("private")</script>' }]);
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
