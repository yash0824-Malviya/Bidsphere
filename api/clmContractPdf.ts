import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_NAME, NETLINK_LOGO_PATH } from "../src/config/branding.js";
import type { ClmRecord, ClmSignature } from "../src/types/clm.js";
import type { ContractPdfContext } from "./clmContractPdfData.js";

// Presentation only: the existing lock/upload/signature service owns all mutations.
const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 56.7, BOTTOM = 57, TOP = HEIGHT - 125;
const CONTENT = WIDTH - MARGIN * 2;
const C = { navy: rgb(15 / 255, 27 / 255, 54 / 255), blue: rgb(20 / 255, 108 / 255, 232 / 255), ink: rgb(.15, .20, .27), muted: rgb(.40, .46, .53), line: rgb(.82, .86, .90), pale: rgb(.95, .97, .985), white: rgb(1, 1, 1) };
const BODY = 10.5;
const documentVersion = (record: ClmRecord) => contractPdfText(record.custom_current_version || "1.0");
type Pair = [string, unknown];
type Receipt = ClmSignature;
export interface ContractPdfOptions { forSigning?: boolean }
export const CONTRACT_PDF_TEMPLATE_VERSION = "netlink-a4-3";

function listNumber(value: number, type: string): string {
  if (type === "1" || value < 1) return String(value);
  if (type.toLowerCase() === "a") {
    let result = "", current = value;
    while (current > 0) { current -= 1; result = String.fromCharCode(97 + current % 26) + result; current = Math.floor(current / 26); }
    return type === "A" ? result.toUpperCase() : result;
  }
  if (value > 3999) return String(value);
  let result = "", current = value;
  for (const [size, symbol] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
    while (current >= size) { result += symbol; current -= size; }
  }
  return type === "i" ? result.toLowerCase() : result;
}

export function contractPdfText(value: unknown): string {
  // Preserve the visible numbering supplied by rich-text ordered lists.
  const lists: Array<{ ordered: boolean; next: number; step: number; type: string }> = [];
  const html = String(value ?? "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const source = html.replace(/<\/?(?:ol|ul)\b[^>]*>|<li\b[^>]*>/gi, (tag, offset: number) => {
      if (/^<\//.test(tag)) { lists.pop(); return "\n"; }
      if (/^<(ol|ul)\b/i.test(tag)) {
        const start = /\bstart\s*=\s*["']?(-?\d+)/i.exec(tag);
        const reversed = /\sreversed(?:\s|=|>)/i.test(tag);
        let count = 0, depth = 0;
        if (reversed && !start) for (const nested of html.slice(offset + tag.length).matchAll(/<\/?(?:ol|ul)\b[^>]*>|<li\b[^>]*>/gi)) {
          if (/^<\//.test(nested[0])) { if (depth === 0) break; depth -= 1; }
          else if (/^<(ol|ul)\b/i.test(nested[0])) depth += 1;
          else if (depth === 0) count += 1;
        }
        const type = /\btype\s*=\s*["']?([aAiI1])(?:["'\s>])/i.exec(tag)?.[1] || "1";
        lists.push({ ordered: /^<ol/i.test(tag), next: start ? Number(start[1]) : reversed ? count : 1, step: reversed ? -1 : 1, type });
        return "\n";
      }
      const current = lists.at(-1);
      if (!current) return "\n";
      const explicit = /\bvalue\s*=\s*["']?(-?\d+)/i.exec(tag);
      if (explicit) current.next = Number(explicit[1]);
      const marker = current.ordered ? `${listNumber(current.next, current.type)}.` : "-";
      current.next += current.step;
      return `\n${"  ".repeat(Math.max(0, lists.length - 1))}${marker} `;
    });
  return source
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (original, code: string) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original; })
    .replace(/\r\n?/g, "\n").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\u00a0/g, " ").trim();
}
const object = (value: unknown): ClmRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
function runtime(record: ClmRecord): ClmRecord {
  if (typeof record.custom_clm_data !== "string") return object(record.custom_clm_data);
  try { return object(JSON.parse(record.custom_clm_data)); } catch { throw new Error("The saved Contract lifecycle data could not be read for PDF generation."); }
}
function dateValue(value: unknown): Date | undefined {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? date : undefined;
}
export function contractPdfDate(value: unknown): string {
  const date = dateValue(value);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : contractPdfText(value);
}
export function contractPdfDuration(start: unknown, end: unknown): string {
  const first = dateValue(start), last = dateValue(end);
  if (!first || !last || last < first) return "";
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000);
  return `${days} ${days === 1 ? "day" : "days"} (between start and end dates)`;
}
function amount(value: unknown, currency: unknown): string {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "";
  return `${contractPdfText(currency)} ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`.trim();
}
export function contractPdfSignatures(record: ClmRecord): Receipt[] {
  const rows = runtime(record).signatures;
  const version = String(record.custom_current_version || "1.0");
  if (!Array.isArray(rows)) return [];
  return (["supplier", "inteva"] as const).flatMap(party => {
    const receipt = [...rows].reverse().find(value => { const row = object(value); return row.party === party && row.version === version && row.by && row.at && row.typed_name && row.file_id && /^\/private\/files\//.test(String(row.file_url || "")) && /^[a-f0-9]{64}$/i.test(String(row.hash || "")); });
    return receipt ? [receipt as Receipt] : [];
  });
}
export function contractPdfStatus(record: ClmRecord, forSigning = false): string {
  const signatures = contractPdfSignatures(record);
  if (signatures.length === 2) return "SIGNED";
  if (signatures.length === 1) return "PARTIALLY SIGNED / PENDING SIGNATURE";
  if (forSigning) return "ISSUED FOR SIGNATURE";
  return record.custom_contract_status === "Draft" ? "DRAFT / PENDING SIGNATURE" : "PENDING SIGNATURE";
}

class ContractLayout {
  page!: PDFPage;
  y = TOP;
  sectionCount = 0;
  readonly characters: Set<number>;
  constructor(readonly pdf: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont, readonly logo: PDFImage, readonly record: ClmRecord) { this.characters = new Set(regular.getCharacterSet()); }
  newPage() { this.page = this.pdf.addPage([WIDTH, HEIGHT]); this.y = TOP; return this.page; }
  width(text: string, size: number, font = this.regular) {
    // Custom fonts otherwise silently replace missing glyphs with .notdef.
    // Never discard or substitute a character in contractual source text.
    if ([...text].some(char => !this.characters.has(char.codePointAt(0)!))) throw new Error("The embedded Contract font cannot render this text. Attach an approved PDF containing these Contract terms before approval.");
    try { return font.widthOfTextAtSize(text, size); }
    catch { throw new Error("The embedded Contract font cannot render this text. Attach an approved PDF containing these Contract terms before approval."); }
  }
  wrap(value: unknown, width: number, size = BODY, font = this.regular, plainText = false): string[] {
    const result: string[] = [];
    for (const paragraph of (plainText ? String(value ?? "") : contractPdfText(value)).split("\n")) {
      if (!paragraph.trim()) { result.push(""); continue; }
      // Keep nested clause indentation, including on its wrapped lines. Bound
      // indentation so deeply nested source lists still leave room for text.
      let indent = /^[ \t]*/.exec(paragraph)![0].replace(/\t/g, "  ");
      while (indent && this.width(indent, size, font) > Math.min(60, width / 3)) indent = indent.slice(0, -1);
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (this.width(indent + next, size, font) <= width) { line = next; continue; }
        if (line) { result.push(indent + line); line = ""; }
        // Long identifiers/URLs are split, never clipped or discarded.
        for (const char of word) {
          if (line && this.width(indent + line + char, size, font) > width) { result.push(indent + line); line = ""; }
          line += char;
        }
      }
      if (line) result.push(indent + line);
    }
    return result.length ? result : [""];
  }
  text(value: string, x: number, y: number, size = BODY, font = this.regular, color = C.ink) {
    this.width(value, size, font); this.page.drawText(value, { x, y, size, font, color });
  }
  ensure(height: number) { if (this.y - height < BOTTOM) this.newPage(); }
  nextSection(title: string, firstHeight = 36) {
    const number = `${++this.sectionCount}.`;
    this.section(number, title, firstHeight);
    return number;
  }
  section(number: string, title: string, firstHeight = 36) {
    this.ensure(40 + firstHeight);
    this.y -= 9;
    this.text(number, MARGIN, this.y, 12, this.bold, C.blue);
    this.text(title, MARGIN + 25, this.y, 12, this.bold, C.navy);
    this.y -= 11;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: WIDTH - MARGIN, y: this.y }, thickness: .6, color: C.line });
    this.y -= 20;
  }
  paragraph(value: unknown, size = BODY, leading = 15, inset = 0, keepTogether = true, plainText = false) {
    const lines = this.wrap(value, CONTENT - inset, size, this.regular, plainText);
    // A normal clause stays together; exceptionally long clauses still paginate.
    if (keepTogether && lines.length * leading + 5 <= TOP - BOTTOM) this.ensure(lines.length * leading + 5);
    for (let i = 0; i < lines.length; i++) {
      // Leave at least two lines together when breaking a paragraph.
      this.ensure(i < lines.length - 1 ? leading * 2 : leading);
      if (lines[i]) this.text(lines[i], MARGIN + inset, this.y, size);
      this.y -= leading;
    }
    this.y -= 5;
  }
  info(pairs: Pair[], columns = 2) {
    const entries = pairs.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
    if (!entries.length) return;
    const cellWidth = CONTENT / columns;
    for (let offset = 0; offset < entries.length; offset += columns) {
      const row = entries.slice(offset, offset + columns);
      const lines = row.map(([, value]) => this.wrap(value, cellWidth - 24, 10));
      const height = Math.max(...lines.map(value => value.length)) * 14 + 29;
      // Metadata can be long; use the paginated table rather than a giant cell.
      if (height > TOP - BOTTOM - 30) { this.table(["Field", "Details"], [.3, .7], row.map(([key, value]) => [key, contractPdfText(value)])); continue; }
      this.ensure(height);
      this.page.drawRectangle({ x: MARGIN, y: this.y - height + 10, width: CONTENT, height, color: C.pale, borderWidth: .5, borderColor: C.line });
      row.forEach(([key], i) => {
        const x = MARGIN + i * cellWidth + 12;
        this.text(key.toUpperCase(), x, this.y - 4, 8.5, this.bold, C.muted);
        lines[i].forEach((line, j) => this.text(line, x, this.y - 20 - j * 14, 10));
      });
      this.y -= height;
    }
    this.y -= 12;
  }
  table(headers: string[], proportions: number[], rows: string[][], rightAligned: number[] = []) {
    const widths = proportions.map(value => CONTENT * value);
    const leading = 14, pad = 9, headHeight = 27;
    const head = () => {
      this.page.drawRectangle({ x: MARGIN, y: this.y - headHeight + 9, width: CONTENT, height: headHeight, color: C.pale, borderColor: C.line, borderWidth: .5 });
      let x = MARGIN;
      headers.forEach((label, i) => { const text = label.toUpperCase(); this.text(text, rightAligned.includes(i) ? x + widths[i] - pad - this.width(text, 8, this.bold) : x + pad, this.y - 8, 8, this.bold, C.navy); x += widths[i]; });
      this.y -= headHeight;
    };
    this.ensure(headHeight + leading + pad * 2); head();
    rows.forEach((row, index) => {
      const cells = row.map((value, i) => this.wrap(value, widths[i] - pad * 2, 10));
      const count = Math.max(...cells.map(lines => lines.length));
      let consumed = 0;
      while (consumed < count) {
        const remainingHeight = (count - consumed) * leading + pad * 2;
        if (remainingHeight <= TOP - BOTTOM - headHeight && remainingHeight > this.y - BOTTOM) { this.newPage(); head(); }
        let capacity = Math.floor((this.y - BOTTOM - pad * 2) / leading);
        if (capacity < 1) { this.newPage(); head(); capacity = Math.floor((this.y - BOTTOM - pad * 2) / leading); }
        const take = Math.min(count - consumed, capacity), height = take * leading + pad * 2;
        this.page.drawRectangle({ x: MARGIN, y: this.y - height + 9, width: CONTENT, height, color: index % 2 === 0 ? C.white : C.pale, borderColor: C.line, borderWidth: .5 });
        let x = MARGIN;
        cells.forEach((lines, col) => { lines.slice(consumed, consumed + take).forEach((line, j) => this.text(line, rightAligned.includes(col) ? x + widths[col] - pad - this.width(line, 10) : x + pad, this.y - 7 - j * leading, 10)); x += widths[col]; });
        this.y -= height; consumed += take;
        if (consumed < count) { this.newPage(); head(); }
      }
    });
    this.y -= 15;
  }
  furniture(firstPage = 0, forSigning = false) {
    const pages = this.pdf.getPages(), total = pages.length;
    for (let i = firstPage; i < total; i++) {
      this.page = pages[i];
      const logoSize = this.logo.scaleToFit(51, 55);
      this.page.drawImage(this.logo, { x: MARGIN, y: HEIGHT - 89, ...logoSize });
      this.text("NETLINK", MARGIN + 66, HEIGHT - 56, 13, this.bold, C.navy);
      this.text("PROCUREMENT", MARGIN + 66, HEIGHT - 72, 8.2, this.bold, C.muted);
      this.text(`AT ISSUE: ${contractPdfStatus(this.record, forSigning)}`, MARGIN + 66, HEIGHT - 87, 6.5, this.regular, C.muted);
      const title = "CONTRACT AGREEMENT";
      this.text(title, WIDTH - MARGIN - this.width(title, 9, this.bold), HEIGHT - 54, 9, this.bold, C.navy);
      const reference = contractPdfText(this.record.name);
      let refSize = 9;
      while (this.width(reference, refSize) > 220 && refSize > 5) refSize -= .25;
      this.text(reference, WIDTH - MARGIN - this.width(reference, refSize), HEIGHT - 72, refSize, this.regular, C.muted);
      const version = `Version ${documentVersion(this.record)}`;
      this.text(version, WIDTH - MARGIN - this.width(version, 8), HEIGHT - 87, 8, this.regular, C.muted);
      this.page.drawLine({ start: { x: MARGIN, y: HEIGHT - 102 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 102 }, thickness: 1.4, color: C.blue });
      this.page.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: WIDTH - MARGIN, y: 44 }, thickness: .6, color: C.line });
      this.text("Netlink · BidSphere", MARGIN, 29, 7.4, this.bold, C.muted);
      const footerReference = "CONFIDENTIAL - PROCUREMENT DOCUMENT";
      const centerSize = 6.5;
      this.text(footerReference, (WIDTH - this.width(footerReference, centerSize)) / 2, 29, centerSize, this.regular, C.muted);
      const pagination = `Page ${i + 1} of ${total}`;
      this.text(pagination, WIDTH - MARGIN - this.width(pagination, 7.4), 29, 7.4, this.regular, C.muted);
    }
  }
}

async function layout(pdf: PDFDocument, record: ClmRecord) {
  // Read the same official asset as the app. It is included in the server bundle.
  const [logoBytes, fontBytes] = await Promise.all([
    readFile(new URL(`../public${NETLINK_LOGO_PATH}`, import.meta.url)),
    readFile(new URL("../public/fonts/Roboto-Regular.ttf", import.meta.url)),
  ]);
  pdf.registerFontkit(fontkit);
  const [regular, logo] = await Promise.all([pdf.embedFont(fontBytes, { subset: true }), pdf.embedPng(logoBytes)]);
  // The repository contains one approved font weight. Use its real outlines
  // throughout, with size, spacing and brand color providing the hierarchy.
  return new ContractLayout(pdf, regular, regular, logo, record);
}

function signatureSection(doc: ContractLayout, record: ClmRecord, context: ContractPdfContext, options: ContractPdfOptions) {
  const receipts = contractPdfSignatures(record);
  // On documents issued for signature, the unchanged signing service reserves
  // the final page bottom for supplier (.27) and Legal (.73) signature boxes.
  const buyer = context.company || COMPANY_NAME;
  const supplier = contractPdfText(context.supplierName || record.custom_supplier || record.party_name).replace(/^(["'])(.*)\1$/, "$2");
  const width = CONTENT / 2 - 6;
  const cards = (["supplier", "inteva"] as const).map(party => {
    const receipt = receipts.find(row => row.party === party);
    const identity = party === "supplier" ? supplier : buyer;
    const signatory = receipt?.full_legal_name || receipt?.typed_name || (party === "inteva" ? record.custom_inteva_signatory : record.custom_supplier_signatory_name) || "________________________";
    const role = receipt?.signatory_role || (party === "supplier" ? "Supplier authorized signatory" : record.custom_rfq ? "Legal Manager" : "Company authorized signatory");
    return { party, receipt, identity, signatory, role };
  });
  // Long legal identities are printed in full in a paginated table, with a
  // reference in the compact signing blocks. Never truncate or enter the area
  // reserved for the existing electronic signature operation.
  const identityLines = (card: typeof cards[number]) => doc.wrap(card.identity, width - 22, 9).length + doc.wrap(card.signatory, width - 22, 9).length + doc.wrap(card.role, width - 22, 8).length;
  const overflow = cards.some(card => identityLines(card) > 6);
  const cardHeight = Math.max(...cards.map(card => 116 + (overflow ? 0 : identityLines(card) - 3) * 12));
  // A report of both persisted signatures needs no empty signing canvas.
  // Approved PDFs issued for signing retain the exact existing signing area.
  const reserveSigningSpace = options.forSigning || receipts.length < 2;
  const ensureBlocks = (withHeading = true) => { if (doc.y < (reserveSigningSpace ? 167 : BOTTOM) + cardHeight + (withHeading ? 37 : -10)) doc.newPage(); };
  if (!receipts.length && !overflow) {
    ensureBlocks();
    // Keep the pending identity cards next to the fixed signing areas used by
    // the existing signer, rather than separating them by half an empty page.
    if (reserveSigningSpace) doc.y = Math.min(doc.y, 207 + cardHeight);
  }
  const receiptDetails = (receipt: Receipt): Pair[] => [
    ["Signer", receipt.full_legal_name || receipt.typed_name], ["Email / user", receipt.signer_email || receipt.by],
    ["Role", receipt.signatory_role || (receipt.party === "supplier" ? "Supplier authorized signatory" : receipt.role === "legal" || record.custom_rfq ? "Legal Manager" : "Company authorized signatory")],
    ["Signed at", receipt.at], ["Document version", receipt.version], ["Signature status", "SIGNED"],
  ];
  const receiptEvidence = (receipt: Receipt) => [
    `Signed document: ${receipt.file_id}`, `Document SHA-256: ${receipt.hash}`,
    ...(receipt.request_id ? [`Signature request: ${receipt.request_id}`] : []),
  ];
  const receiptHeight = (receipt: Receipt) => {
    const fields = receiptDetails(receipt);
    let height = 42 + doc.wrap(receipt.typed_name, CONTENT, 14).length * 18 + 5 + 12 + 8;
    for (let index = 0; index < fields.length; index += 2) height += Math.max(...fields.slice(index, index + 2).map(([, value]) => doc.wrap(value, CONTENT / 2 - 24, 10).length)) * 14 + 29;
    return height + receiptEvidence(receipt).reduce((sum, value) => sum + doc.wrap(value, CONTENT, 9).length * 12 + 5, 0);
  };
  const firstReceiptHeight = receipts.length ? receiptHeight(receipts[0]) : 0;
  const sectionNumber = doc.nextSection("SIGNATURES", receipts.length ? Math.min(firstReceiptHeight + 20, TOP - BOTTOM - 40) : 60);
  if (receipts.length) {
    doc.text("Electronic Signature Record", MARGIN, doc.y, 10, doc.bold, C.navy); doc.y -= 20;
    for (const receipt of receipts) {
      const height = receiptHeight(receipt);
      doc.ensure(height <= TOP - BOTTOM - 60 ? height : 110);
      doc.text(receipt.party === "supplier" ? "SUPPLIER SIGNED" : "COMPANY SIGNED", MARGIN, doc.y, 11, doc.bold, C.blue); doc.y -= 22;
      doc.text("RECORDED TYPED SIGNATURE", MARGIN, doc.y, 8, doc.regular, C.muted); doc.y -= 20;
      doc.paragraph(receipt.typed_name, 14, 18);
      doc.info(receiptDetails(receipt));
      // Full-width evidence avoids splitting a short hash onto a separate page.
      for (const evidence of receiptEvidence(receipt)) doc.paragraph(evidence, 9, 12);
      doc.y -= 8;
    }
  }
  // Completed receipt reports already contain both parties' actual identity,
  // role, timestamp and document evidence. Do not append empty signing cards.
  if (!reserveSigningSpace) return doc.pdf.getPageCount();
  if (overflow) doc.table(["Signing party", "Signatory details"], [.26, .74], cards.map(card => [card.party === "supplier" ? "Supplier" : "Buyer", `${card.identity}\n${card.role}\n${card.signatory}`]));
  const priorPage = doc.pdf.getPageCount();
  ensureBlocks(false);
  if (doc.pdf.getPageCount() !== priorPage) doc.section(sectionNumber, "SIGNATURES (CONTINUED)", 60);
  const cardTop = doc.y;
  cards.forEach((card, index) => {
    const { party, receipt } = card, x = MARGIN + index * (CONTENT / 2 + 6);
    const buyerTitle = `FOR ${contractPdfText(buyer).toUpperCase()}`;
    const title = party === "supplier" ? "FOR SUPPLIER" : doc.width(buyerTitle, 9.5, doc.bold) <= width - 22 ? buyerTitle : "FOR BUYER";
    doc.page.drawRectangle({ x, y: cardTop - cardHeight + 10, width, height: cardHeight, color: C.pale, borderColor: C.line, borderWidth: .6 });
    let y = cardTop - 7;
    doc.text(title, x + 11, y, 9.5, doc.bold, C.navy); y -= 18;
    const line = (value: unknown, size = 9, color = C.ink) => { for (const text of doc.wrap(value, width - 22, size)) { doc.text(text, x + 11, y, size, doc.regular, color); y -= 12; } };
    line(overflow ? "Full identity in signatory details above" : card.identity); y -= 5;
    line(overflow ? "Role recorded above" : card.role, 8, C.muted);
    line(overflow ? "See signatory details above" : card.signatory); y -= 5;
    line(`${options.forSigning ? "Status at issue" : "Status"}: ${receipt ? "SIGNED" : "PENDING"}`, 8.5);
    line(`Date: ${receipt?.at || "________________________"}`, 8.5);
    // Space below y=157 is reserved for the existing real electronic signature.
    if (reserveSigningSpace && !receipt) {
      doc.text("Signature", x + 11, 154, 7.5, doc.regular, C.muted);
      doc.page.drawLine({ start: { x: x + 11, y: 69 }, end: { x: x + width - 11, y: 69 }, thickness: .6, color: C.line });
    }
  });
  return doc.pdf.getPageCount();
}

function auditSection(doc: ContractLayout, record: ClmRecord, context: ContractPdfContext) {
  const data = runtime(record), version = documentVersion(record);
  doc.nextSection("DOCUMENT CONTROL AND AUDIT", 70);
  doc.paragraph(`PDF template: ${CONTRACT_PDF_TEMPLATE_VERSION}`, 9, 12);
  doc.info([
    ["Record created", [record.creation, record.owner ? `Created by: ${record.owner}` : undefined].filter(Boolean).join("\n")],
    ["Record last updated", [record.modified, record.modified_by ? `Last updated by: ${record.modified_by}` : undefined].filter(Boolean).join("\n")],
  ]);
  if (/^[a-f0-9]{64}$/i.test(String(data.locked_hash || ""))) {
    doc.table(["Integrity reference", "Saved value"], [.3, .7], [["Approved content SHA-256", String(data.locked_hash)]]);
  }
  const approved = Array.isArray(data.approvals) ? data.approvals.map(object).filter(row => row.status === "Approved" && row.by && row.at) : [];
  if (approved.length) {
    doc.table(["Approved role", "Approver", "Recorded at"], [.22, .43, .35], approved.map(row => [contractPdfText(row.role), contractPdfText(row.by), contractPdfText(row.at)]));
  }
  if (context.sourceRecords?.length) {
    doc.ensure(48); doc.text("SOURCE RECORDS / PERSISTED REVISIONS", MARGIN, doc.y, 9, doc.bold, C.muted); doc.y -= 18;
    for (const row of context.sourceRecords) doc.paragraph(`${row.doctype}: ${row.name} | ${row.modified || "Not recorded"}`, 9, 12);
  }
  const audit = Array.isArray(data.audit) ? data.audit.map(object).filter(row => (!row.version || String(row.version) === version) && row.action && row.by && row.at) : [];
  if (audit.length) {
    doc.table(["Recorded action", "User / role", "Recorded at"], [.35, .35, .3], audit.map(row => [contractPdfText(row.action), [row.by, row.role].filter(Boolean).map(contractPdfText).join("\n"), contractPdfText(row.at)]));
  }
}

/** Same pdf-lib generator used by Contract locking; no upload, save or workflow action. */
export async function generateClmContractPdf(record: ClmRecord, context: ContractPdfContext, options: ContractPdfOptions = {}): Promise<{ bytes: Uint8Array; signature_page: number }> {
  const pdf = await PDFDocument.create(), doc = await layout(pdf, record);
  pdf.setTitle(`Procurement Contract - ${record.name || ""}`); pdf.setAuthor(`${COMPANY_NAME} Procurement`); pdf.setSubject("Procurement contract and persisted execution information");
  pdf.setKeywords(["BidSphere", "Netlink", String(record.name || ""), `Version ${documentVersion(record)}`]);
  doc.newPage();
  doc.text("CONTRACT AGREEMENT", MARGIN, doc.y, 22, doc.bold, C.navy); doc.y -= 24;
  doc.text(contractPdfStatus(record, options.forSigning), MARGIN, doc.y, 9, doc.bold, C.blue); doc.y -= 24;
  if (contractPdfText(record.custom_contract_title)) doc.paragraph(record.custom_contract_title);
  const source = object(runtime(record).rfq_context), supplier = contractPdfText(context.supplierName || record.custom_supplier || record.party_name).replace(/^(["'])(.*)\1$/, "$2");
  const award = context.awardId || source.award_id;
  doc.nextSection("CONTRACT SUMMARY", 60);
  doc.info([
    ["Contract No.", record.name], ["Contract type", record.custom_contract_type],
    ["Supplier", supplier], ["Contract value", amount(record.custom_contract_value, record.custom_currency)],
    ["Company", context.company || COMPANY_NAME], ["Department", context.department],
    ["RFQ", record.custom_rfq], ["Award", award],
    ["Winning quotation", record.custom_supplier_quotation], ["Document version", record.custom_current_version || "1.0"],
    ["Contract start date", contractPdfDate(record.start_date)], ["Contract end date", contractPdfDate(record.end_date)],
    ["Contract status at issue", record.custom_contract_status], ["Signature status at issue", contractPdfStatus(record, options.forSigning)],
  ]);
  if (record.custom_rfq || award || record.custom_supplier_quotation) {
    doc.nextSection("PROCUREMENT & AWARD DETAILS", 65);
    doc.info([["RFQ reference", record.custom_rfq], ["RFQ title", context.rfqTitle], ["Award reference", award], ["Winning quotation", record.custom_supplier_quotation], ["Award value", amount(context.awardValue, context.awardCurrency)], ["Supplier", supplier], ["Company", context.company || COMPANY_NAME], ["Department", context.department]]);
  }
  const scopes: Pair[] = [["CONTRACT DESCRIPTION", record.custom_contract_title], ["RFQ SCOPE", context.rfqScope]];
  const savedScopes = scopes.filter(([, value]) => !!contractPdfText(value));
  if (savedScopes.length || context.items.length) {
    const scopeHeight = (value: unknown) => 18 + doc.wrap(value, CONTENT).length * 15 + 5;
    const firstHeight = savedScopes.length ? scopeHeight(savedScopes[0][1]) : 100;
    doc.nextSection("SCOPE OF CONTRACT", firstHeight <= TOP - BOTTOM - 40 ? firstHeight : 65);
    for (const [label, value] of savedScopes) {
      const height = scopeHeight(value), fits = height <= TOP - BOTTOM - 40;
      doc.ensure(fits ? height : 48);
      doc.text(label, MARGIN, doc.y, 9, doc.bold, C.muted); doc.y -= 18;
      doc.paragraph(value, BODY, 15, 0, fits);
    }
    if (context.items.length) {
      doc.ensure(100); doc.text("AWARDED ITEMS", MARGIN, doc.y, 10, doc.bold, C.navy); doc.y -= 20;
      if (context.itemSource) doc.paragraph(`Item scope: winning Supplier Quotation ${context.itemSource.name}. Final award value is stated above.`, 10, 14);
      doc.table(["#", "Item", "Quantity", "UOM", "Description"], [.08, .295, .145, .10, .38], context.items.map((item, index) => [
        String(index + 1), [item.item, item.itemCode && item.itemCode !== item.item ? `Item code: ${item.itemCode}` : ""].filter(Boolean).join("\n"),
        String(item.qty), item.uom, item.description || "",
      ]), [0, 2]);
    }
  }
  doc.nextSection("COMMERCIAL TERMS", 65);
  doc.table(["Commercial reference", "Agreed value"], [.45, .55], [["Contract value", amount(record.custom_contract_value, record.custom_currency)]].filter(([, value]) => !!value), [1]);
  const renewal = record.custom_auto_renewal;
  doc.info([
    ["Payment terms", record.custom_payment_terms],
    ["Contract duration", contractPdfDuration(record.start_date, record.end_date)],
    ["Auto renewal", renewal === 1 || renewal === "1" || renewal === true ? "Yes" : renewal === 0 || renewal === "0" || renewal === false ? "No" : undefined],
    ["Renewal notice (days)", Number(record.custom_renewal_notice_days) === 0 && (renewal === 0 || renewal === "0" || renewal === false) ? undefined : record.custom_renewal_notice_days],
  ]);
  const configuredClauses: Pair[] = [["Pricing terms", record.custom_pricing_terms], ["Payment terms description", record.custom_payment_terms_description], ["Delivery requirements", record.custom_delivery_terms], ["Incentives", record.custom_incentives], ["Penalties", record.custom_penalties], ["Renewal terms", record.custom_renewal_terms]];
  const technicalClauses: Pair[] = [["Quality requirements", record.custom_quality_requirements], ["Service levels / KPI commitments", record.custom_sla__kpi_commitments], ["Part numbers", record.custom_part_numbers], ["Program", record.custom_program_name]];
  const clauses = [...configuredClauses, ...technicalClauses].filter(([, value]) => !!contractPdfText(value));
  const clauseHeight = (value: unknown) => 24 + doc.wrap(value, CONTENT, BODY).length * 15;
  const renderClause = (title: string, value: unknown, keepTogether = true) => {
    const height = clauseHeight(value);
    doc.ensure(keepTogether && height <= TOP - BOTTOM ? height : 46);
    doc.text(title, MARGIN, doc.y, 10, doc.bold, C.navy); doc.y -= 19;
    doc.paragraph(value, BODY, 15, 0, keepTogether && height <= TOP - BOTTOM);
  };
  if (clauses.length) {
    let technicalHeading = false;
    clauses.forEach(([title, value]) => {
      if (!technicalHeading && technicalClauses.some(([technicalTitle]) => title === technicalTitle)) {
        doc.ensure(78); doc.text("TECHNICAL AND PERFORMANCE TERMS", MARGIN, doc.y, 10, doc.bold, C.blue); doc.y -= 23; technicalHeading = true;
      }
      renderClause(title, value);
    });
  }
  if (contractPdfText(record.contract_terms) || contractPdfText(record.custom_termination_clauses)) {
    const paragraphs = contractPdfText(record.contract_terms).split(/\n\s*\n/).filter(Boolean);
    const firstHeight = paragraphs.length ? doc.wrap(paragraphs[0], CONTENT, BODY, doc.regular, true).length * 15 + 5 : clauseHeight(record.custom_termination_clauses);
    const firstFits = firstHeight <= TOP - BOTTOM - 40;
    doc.nextSection("CONTRACT TERMS", firstFits ? firstHeight : 55);
    // Existing clause text and explicit list numbering remain intact.
    paragraphs.forEach((paragraph, index) => doc.paragraph(paragraph, BODY, 15, 0, index > 0 || firstFits, true));
    if (contractPdfText(record.custom_termination_clauses)) renderClause("Termination", record.custom_termination_clauses, paragraphs.length > 0 || firstFits);
  }
  if (context.documents.length) {
    doc.nextSection("SUPPORTING DOCUMENTS", 65);
    doc.table(["Document / source", "Type", "Uploaded"], [.61, .15, .24], context.documents.map(document => [[document.name, document.reference].filter(Boolean).join("\n"), document.documentType || "", contractPdfDate(document.uploadedAt)]));
  }
  auditSection(doc, record, context);
  const signature_page = signatureSection(doc, record, context, options);
  doc.furniture(0, options.forSigning);
  return { bytes: await pdf.save({ useObjectStreams: false }), signature_page };
}

/** Uploaded legal documents retain their original pages; only the appended execution sheet is styled. */
export async function appendClmExecutionPage(pdf: PDFDocument, record: ClmRecord): Promise<number> {
  const firstPage = pdf.getPageCount(), doc = await layout(pdf, record);
  doc.newPage();
  doc.text("APPROVED CONTRACT EXECUTION", MARGIN, doc.y, 17, doc.bold, C.navy); doc.y -= 29;
  doc.info([["Contract reference", record.name], ["Approved version", record.custom_current_version || "1.0"], ["Supplier", record.custom_supplier || record.party_name], ["Contract period", `${contractPdfDate(record.start_date)} - ${contractPdfDate(record.end_date)}`]]);
  doc.paragraph("The preceding pages contain the final approved Contract. Review those pages before confirming your intent to sign.");
  const signature_page = signatureSection(doc, record, { items: [], documents: [] }, { forSigning: true });
  doc.furniture(firstPage, true);
  return signature_page;
}
