import { describe, expect, it } from "vitest";
import type { ECRComment } from "../../../api/ecr";
import type { EngineeringChangeRequest } from "../../../types/erpnext";
import { buildECRActivityEvents, ecrActivityPlainText, selectECRActivityRecords } from "./engineerEcrActivity";

function ecr(index: number, extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name: `private-${index}`,
    ecr_number: `ECR-2026-${100000 + index}`,
    modified: `2026-09-${String(index + 1).padStart(2, "0")} 10:00:00`,
    ...extra,
  } as EngineeringChangeRequest;
}

function comment(index: number, extra: Partial<ECRComment> = {}): ECRComment {
  return {
    name: `comment-${index}`,
    content: `Recorded event ${index}`,
    comment_type: "Workflow",
    creation: `2026-09-${String(index + 1).padStart(2, "0")} 11:00:00`,
    ...extra,
  };
}

describe("Engineer ECR activity model", () => {
  it("selects only the five most recently modified distinct records without mutating its scope", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ecr(index));
    const names = rows.map((row) => row.name);
    expect(selectECRActivityRecords([...rows, rows[7]]).map((row) => row.name)).toEqual([
      "private-7", "private-6", "private-5", "private-4", "private-3",
    ]);
    expect(rows.map((row) => row.name)).toEqual(names);
  });

  it("merges actual comments across ECRs, deduplicates and keeps the newest five events", () => {
    const first = [comment(0), comment(2), comment(4), comment(6), comment(6)];
    const second = [comment(1), comment(3), comment(5)];
    const events = buildECRActivityEvents([
      { ecr: ecr(0), comments: first },
      { ecr: ecr(1), comments: second },
    ]);
    expect(events.map((event) => event.content)).toEqual([
      "Recorded event 6", "Recorded event 5", "Recorded event 4", "Recorded event 3", "Recorded event 2",
    ]);
    expect(events[0]).toMatchObject({ ecrNumber: "ECR-2026-100000", timestamp: "2026-09-07T11:00:00" });
  });

  it("does not infer events from a current approved stage or a last-modified timestamp", () => {
    expect(buildECRActivityEvents([{ ecr: ecr(1, { select_pxfp: "Approved" }), comments: [] }])).toEqual([]);
    expect(buildECRActivityEvents([{
      ecr: ecr(1),
      comments: [comment(1, { creation: "invalid" }), comment(2, { content: "<p> </p>" })],
    }])).toEqual([]);
  });

  it("removes executable markup and decodes text entities without evaluating HTML", () => {
    expect(ecrActivityPlainText('<p>Submitted &amp; approved</p><script>alert(1)</script><style>body{color:red}</style><img src=x onerror="alert(1)"><p>Review&#32;complete&nbsp;&#x2713;</p>'))
      .toBe("Submitted & approved Review complete ✓");
    expect(ecrActivityPlainText("&lt;img src=x onerror=alert(1)&gt;")).toBe("<img src=x onerror=alert(1)>");
  });
});
