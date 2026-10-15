import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalDocumentSet, LegalSignatureEligibilityResult } from "./legalDocs";
import { createEmptyEnvelope, type LegalDocKey } from "../types/legalEsign";

const scenario = vi.hoisted(() => ({
  loaded: null as LegalDocumentSet | null,
  snapshot: undefined as LegalSignatureEligibilityResult | undefined,
  fetching: false, error: false, injectLoaded: false,
  queryOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    if (scenario.injectLoaded) {
      scenario.injectLoaded = false;
      return actual.useState(scenario.loaded);
    }
    return actual.useState(initial);
  } };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => {
    if (options.queryKey[0] === "legal-signature-eligibility") {
      scenario.queryOptions = options;
      return { data: scenario.snapshot, isSuccess: Boolean(scenario.snapshot), isFetching: scenario.fetching, isError: scenario.error, refetch: vi.fn() };
    }
    return { isLoading: false, isError: false, data: options.queryKey[0] === "rfq"
      ? { name: "RFQ-TEST", status: "Submitted", items: [], suppliers: [] }
      : options.queryKey[0] === "supplier-quotations" ? [] : {} };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../store/authStore", () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { role: "legal", email: "legal@example.test" } }) }));
vi.mock("../components/enterprise", () => ({ AppLoading: () => null, EnterpriseError: () => null, FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../components/sla/SlaStageBadge", () => ({ default: () => null }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "fixture-worker" }));

import LegalReviewDetailPage from "../pages/legal/LegalReviewDetailPage";
import LegalPdfViewer from "../components/legal/LegalPdfViewer";

const keys: LegalDocKey[] = ["terms", "warranty", "insurance"];
function record(verified: number, modified = "2026-09-10 12:00:00"): LegalDocumentSet {
  const row: LegalDocumentSet = { name: "LDR-TEST", sq_name: "SQ-TEST", rfq_name: "RFQ-TEST", supplier: "Supplier", review_status: "Pending", workflow_state: "Pending Review", finance_status: "Pending", required_document_keys: keys, modified };
  const documents = Object.fromEntries(keys.map((key, index) => {
    row[`${key}_approved`] = index < verified ? 1 : 0;
    row[`${key}_file_url`] = `/private/files/${key}.pdf`;
    const env = createEmptyEnvelope({ documentKey: key, documentName: key, documentNumber: row.name!, documentHash: "a".repeat(64) });
    Object.assign(env, { sourceFileId: `FILE-${key}`, sourceFileUrl: row[`${key}_file_url`], viewedBy: "legal@example.test", viewedAt: modified });
    return [key, env];
  }));
  row.esign_envelope = JSON.stringify({ schemaVersion: 2, documents });
  return row;
}
function snapshot(row: LegalDocumentSet, verified: number): LegalSignatureEligibilityResult {
  return { record: row, requiredDocumentKeys: keys, verifiedDocumentKeys: keys.slice(0, verified), pendingDocumentKeys: keys.slice(verified), canSignDocumentKeys: verified === 3 ? keys : [], eligible: verified === 3, checkedAt: "2026-09-10T12:00:01Z" };
}
function renderPage() {
  scenario.injectLoaded = true;
  return renderToString(<MemoryRouter><LegalReviewDetailPage /></MemoryRouter>);
}

describe("fresh server eligibility drives RFQ signing UI", () => {
  beforeEach(() => { scenario.loaded = record(1); scenario.snapshot = snapshot(record(2), 2); scenario.fetching = false; scenario.error = false; scenario.injectLoaded = false; vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it("replaces stale 1/3 local display with server 2/3 and names pending Insurance", () => {
    const html = renderPage();
    expect(html).toContain("2<!-- -->/<!-- -->3<!-- --> Verified");
    expect(html).toContain("Pending required documents: <!-- -->Liability Insurance Certificate");
    expect(html).not.toContain("Ready for E-Signature");
    expect(html).toContain("Refresh status");
  });

  it("enables the signature entry only after a fresh all-required response, with Finance pending", () => {
    scenario.snapshot = snapshot(record(3), 3);
    expect(renderPage()).toContain("Ready for E-Signature");
    expect(renderPage()).toContain("Sign Document");
  });

  it.each(["fetching", "error"] as const)("never enables from stale successful data while %s", state => {
    scenario.snapshot = snapshot(record(3), 3);
    scenario[state] = true;
    const html = renderPage();
    expect(html).not.toContain("Ready for E-Signature");
    expect(html).not.toContain(">Sign Document<");
    expect(html).toContain(state === "fetching" ? "Refreshing signing eligibility" : "Unable to refresh signing eligibility");
  });

  it("does not overwrite a newer mutation with an older eligibility response", () => {
    scenario.loaded = record(2, "2026-09-10 12:02:00");
    scenario.snapshot = snapshot(record(3, "2026-09-10 12:01:00"), 3);
    const html = renderPage();
    expect(html).toContain("2<!-- -->/<!-- -->3<!-- --> Verified");
    expect(html).not.toContain("Ready for E-Signature");
  });

  it("uses the review/version key and refetches when the window regains focus", () => {
    renderPage();
    expect(scenario.queryOptions).toMatchObject({ queryKey: ["legal-signature-eligibility", "LDR-TEST", "2026-09-10 12:00:00"], staleTime: 0, refetchOnWindowFocus: "always", refetchOnReconnect: "always", refetchOnMount: "always" });
  });

  it("viewer shows the full required list near its disabled button, including Insurance", () => {
    const row = record(2);
    const html = renderToString(<LegalPdfViewer review={row} documentKey="warranty" fileUrl={row.warranty_file_url!} canSign={false} esignDisabledReason="Verify all required supplier documents before signing." reviewerFullName="Legal Counsel" reviewerId="legal@example.test" esignBundle={null} onBundleChange={() => {}} />);
    expect(html).toContain("Required documents: <!-- -->2<!-- -->/<!-- -->3<!-- --> verified");
    expect(html).toContain("Pending: <!-- -->Liability Insurance Certificate");
    expect(html).toContain('title="Verify all required supplier documents before signing."');
    expect(html).not.toContain("Ready for E-Signature");
  });

  it("viewer truthfully reports its PDF loading gate even with fresh eligible server state", () => {
    const row = record(3);
    const html = renderToString(<LegalPdfViewer review={row} documentKey="terms" fileUrl={row.terms_file_url!} canSign reviewerFullName="Legal Counsel" reviewerId="legal@example.test" esignBundle={null} onBundleChange={() => {}} />);
    expect(html).toContain("Loading the current PDF before signing…");
    expect(html).not.toContain("Ready for E-Signature");
  });
});
