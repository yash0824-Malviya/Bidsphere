import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const SIGNING_DISABLED = "Layout preview only; no signature was submitted.";
export const clmViewerKey = () => "contract-signing-layout-sample";
export const clmError = (error: unknown) => error instanceof Error ? error.message : String(error);
export async function lookupClm() { return []; }
export async function applyClmAction() { throw new Error(SIGNING_DISABLED); }
let pdfPromise: Promise<Uint8Array> | undefined;
function samplePdf() {
  return pdfPromise ??= (async () => {
    const pdf = await PDFDocument.create();
    const normal = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const pageNumber of [1, 2]) {
      const page = pdf.addPage([612, 792]);
      page.drawRectangle({ x: 0, y: 732, width: 612, height: 60, color: rgb(0.06, 0.12, 0.23) });
      page.drawText("CON-LAYOUT-SAMPLE | UI TEST DOCUMENT", { x: 36, y: 755, size: 17, font: bold, color: rgb(1, 1, 1) });
      const lines = pageNumber === 1 ? ["SAMPLE DATA ONLY - NO ERP CONNECTION", "Supplier: Atlantic Precision Manufacturing", "RFQ: RFQ-LAYOUT-SAMPLE", "Award: AWARD-LAYOUT-SAMPLE", "Winning quotation: QUOTE-LAYOUT-SAMPLE", "Contract value: USD 4,500", "Contract term: 2026-09-25 to 2026-10-25", "", "Layout fixture supply agreement", "The supplier provides materials under the stated sample terms.", "This PDF exists only for responsive layout and scrolling checks.", "It is not an ERPNext contract and cannot be signed or submitted."] : ["SAMPLE DATA ONLY - TERMS CONTINUED", "Delivery: Supply sample materials according to the approved schedule.", "Quality: Include the applicable inspection reports with delivery.", "Payment: Net 30 from accepted invoice, for display verification only.", "", "Review the two pages, then verify the signature controls.", "Enter a full legal name and explicitly confirm signature consent.", "Confirm & Sign Contract deliberately returns a preview-only error.", "No signature, Contract, approval or external message is created."];
      lines.forEach((line, index) => page.drawText(line, { x: 36, y: 699 - index * 26, size: index === 0 ? 12 : 11, font: index === 0 ? bold : normal, color: rgb(0.12, 0.16, 0.22) }));
      page.drawText(`Isolated layout sample - Page ${pageNumber} of 2`, { x: 36, y: 28, size: 9, font: normal, color: rgb(0.4, 0.4, 0.4) });
    }
    return pdf.save();
  })();
}
export async function getClmDocumentBlob(doctype: string, name: string, _field: string, fileId?: string) {
  if (doctype !== "Contract" || name !== "CON-LAYOUT-SAMPLE" || fileId && !["SAMPLE-LOCKED-PDF", "SAMPLE-SUPPORT-PDF"].includes(fileId)) throw new Error("This isolated preview permits only its own sample documents.");
  return new Blob([new Uint8Array(await samplePdf()).buffer], { type: "application/pdf" });
}
