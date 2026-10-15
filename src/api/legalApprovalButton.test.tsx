import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalDocumentSet, LegalSignatureEligibilityResult } from "./legalDocs";
import { createEmptyEnvelope, type LegalDocKey } from "../types/legalEsign";

const scenario = vi.hoisted(() => ({
  loaded: null as LegalDocumentSet | null,
  snapshot: undefined as LegalSignatureEligibilityResult | undefined,
  fetching: false,
  error: false,
  injectLoaded: false,
  role: "legal" as string,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (scenario.injectLoaded) {
        scenario.injectLoaded = false;
        return actual.useState(scenario.loaded);
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => {
    if (options.queryKey[0] === "legal-signature-eligibility") {
      return {
        data: scenario.snapshot,
        isSuccess: Boolean(scenario.snapshot),
        isFetching: scenario.fetching,
        isError: scenario.error,
        refetch: vi.fn(),
      };
    }
    return {
      isLoading: false,
      isError: false,
      data:
        options.queryKey[0] === "rfq"
          ? { name: "PUR-RFQ-2026-00116", status: "Submitted", items: [], suppliers: [] }
          : options.queryKey[0] === "supplier-quotations"
          ? []
          : {},
    };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { role: scenario.role, email: "legal@netlink.com" } }),
}));

vi.mock("../components/enterprise", () => ({
  AppLoading: () => null,
  EnterpriseError: () => null,
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../components/sla/SlaStageBadge", () => ({ default: () => null }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "fixture-worker" }));

import LegalReviewDetailPage from "../pages/legal/LegalReviewDetailPage";

const keys: LegalDocKey[] = ["terms", "warranty", "insurance"];

function makeReview(verifiedCount: number, signedCount: number): LegalDocumentSet {
  const row: LegalDocumentSet = {
    name: "LDC2026-00034",
    sq_name: "PUR-SQTN-2026-00313",
    rfq_name: "PUR-RFQ-2026-00116",
    supplier: "Blue Ridge Manufacturing Inc",
    review_status: "Pending",
    workflow_state: "Pending Review",
    finance_status: "",
    required_document_keys: keys,
    modified: "2026-10-14 12:00:00",
  };

  const documents = Object.fromEntries(
    keys.map((key, index) => {
      row[`${key}_approved`] = index < verifiedCount ? 1 : 0;
      row[`${key}_file_url`] = `/private/files/${key}.pdf`;
      const env = createEmptyEnvelope({
        documentKey: key,
        documentName: `${key}.pdf`,
        documentNumber: row.name!,
        documentHash: "a".repeat(64),
      });
      Object.assign(env, {
        sourceFileId: `FILE-${key}`,
        sourceFileUrl: row[`${key}_file_url`],
        viewedBy: "legal@netlink.com",
        viewedAt: "2026-10-14 12:00:00",
      });

      if (index < signedCount) {
        env.signedFileUrl = `/private/files/signed-${key}.pdf`;
        env.signedFileHash = "b".repeat(64);
        env.status = "locked";
        env.locked = true;
        env.signatureRequest = {
          id: `SIG-${key}`,
          sourceHash: env.documentHash,
          sourceFileId: env.sourceFileId ?? `FILE-${key}`,
          signerId: "legal@netlink.com",
          startedAt: "2026-10-14T12:00:00Z",
          completedAt: "2026-10-14T12:01:00Z",
        };
        env.signatures = [
          {
            id: `SIG-${key}`,
            sequence: 1,
            role: "legal",
            reviewerName: "Legal Manager",
            reviewerId: "legal@netlink.com",
            typedName: "Legal Manager",
            fontId: "allura",
            signedAt: "2026-10-14T12:01:00Z",
            placement: { widthNorm: 0.2, heightNorm: 0.05, page: 1, xNorm: 0.8, yNorm: 0.8 },
            status: "locked",
          },
        ];
      }

      return [key, env];
    })
  );

  row.esign_envelope = JSON.stringify({ schemaVersion: 2, documents });
  return row;
}

function makeSnapshot(row: LegalDocumentSet, verifiedCount: number): LegalSignatureEligibilityResult {
  return {
    record: row,
    requiredDocumentKeys: keys,
    verifiedDocumentKeys: keys.slice(0, verifiedCount),
    pendingDocumentKeys: keys.slice(verifiedCount),
    canSignDocumentKeys: verifiedCount === 3 ? keys : [],
    eligible: verifiedCount === 3,
    checkedAt: "2026-10-14T12:00:01Z",
  };
}

function renderDetailPage() {
  scenario.injectLoaded = true;
  return renderToString(
    <MemoryRouter>
      <LegalReviewDetailPage />
    </MemoryRouter>
  );
}

describe("Approve Legal Review button conditional rendering", () => {
  beforeEach(() => {
    scenario.role = "legal";
    scenario.fetching = false;
    scenario.error = false;
    scenario.injectLoaded = false;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("hides Approve button and shows pending verification explanation when 2 of 3 documents are verified (PUR-SQTN-2026-00313 state)", () => {
    const row = makeReview(2, 0); // 2 verified, 0 signed (exact state of PUR-SQTN-2026-00313)
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 2);

    const html = renderDetailPage();
    expect(html).not.toContain("Approve Legal Review");
    expect(html).toContain("Document Verification Required Before Approval");
    expect(html).toContain("Pending verification: Liability Insurance Certificate.");
    expect(html).toContain("E-Signature Required Before Finance Review");
    expect(html).toContain("Reject Legal Review");
    expect(html).toContain("Request Revision");
  });

  it("hides Approve button and shows E-Signature Required when all 3 documents are verified but not yet signed", () => {
    const row = makeReview(3, 0); // 3 verified, 0 signed
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 3);

    const html = renderDetailPage();
    expect(html).not.toContain("Approve Legal Review");
    expect(html).not.toContain("Document Verification Required Before Approval");
    expect(html).toContain("E-Signature Required Before Finance Review");
    expect(html).toContain("Reject Legal Review");
    expect(html).toContain("Request Revision");
  });

  it("hides Approve button when 2 of 3 are signed but 1 is still unsigned", () => {
    const row = makeReview(3, 2); // 3 verified, 2 signed
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 3);

    const html = renderDetailPage();
    expect(html).not.toContain("Approve Legal Review");
    expect(html).toContain("E-Signature Required Before Finance Review");
  });

  it("restores and displays the Approve Legal Review button when all documents are verified and electronically signed", () => {
    const row = makeReview(3, 3); // 3 verified, 3 signed (all conditions satisfied)
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 3);

    const html = renderDetailPage();
    expect(html).toContain("Approve Legal Review");
    expect(html).toContain("Reject Legal Review");
    expect(html).toContain("Request Revision");
    expect(html).not.toContain("Document Verification Required Before Approval");
    expect(html).not.toContain("E-Signature Required Before Finance Review");
  });

  it("hides Approve button for unauthorized roles (e.g. procurement) even if all documents were signed", () => {
    scenario.role = "procurement";
    const row = makeReview(3, 3);
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 3);

    const html = renderDetailPage();
    expect(html).not.toContain("Approve Legal Review");
  });

  it("renders Approve button for admin role when all documents are verified and signed", () => {
    scenario.role = "admin";
    const row = makeReview(3, 3);
    scenario.loaded = row;
    scenario.snapshot = makeSnapshot(row, 3);

    const html = renderDetailPage();
    expect(html).toContain("Approve Legal Review");
  });
});
