import { ClmError, type ClmDeps } from "./clmCore.js";
import { canonicalErpFilePath } from "./fileProxyCore.js";
import type { ClmRecord, RfqClmSourceDocument } from "../src/types/clm.js";

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object") as ClmRecord[] : [];
const pathOf = (value: unknown): string => canonicalErpFilePath(text(value)) || "";
const quotationFields = ["custom_terms__condition", "custom_terms_condition", "custom_warenty_certificate", "custom_warranty_certificate", "custom_insurance_certificate"];
const reviewFields = ["terms_file_url", "warranty_file_url", "insurance_file_url", "esign_signed_file_url"];
interface Source { doctype: string; record: ClmRecord; paths: Set<string> }

function jsonRows(value: unknown): ClmRecord[] {
  try { return rows(typeof value === "string" ? JSON.parse(value) : value); }
  catch { return []; }
}

function engineeringPaths(record: ClmRecord): Set<string> {
  return new Set([
    pathOf(record.custom_2d_drawing),
    ...jsonRows(record.custom_engineering_attachments).map(row => pathOf(row.fileUrl || row.file_url || row.url)),
  ].filter(Boolean));
}

function fieldsPaths(record: ClmRecord, fields: string[]): Set<string> {
  return new Set(fields.map(field => pathOf(record[field])).filter(Boolean));
}

/** Negative checks supplement source provenance: an attachment slot can contain a wrong upload. */
function unrelatedFile(file: ClmRecord, rfq: string, quotation: string, award: string, po = ""): string {
  const label = `${text(file.file_name)} ${pathOf(file.file_url)}`;
  const words = label.replace(/[_-]+/g, " ");
  if (/\b(?:payments?|invoices?|receipts?|remittance)\s+(?:report|register|statement)\b|\bbank\s+statement\b/i.test(words)) return "a payment, invoice or banking report";
  const references: Array<[RegExp, string, string]> = [
    [/\bPUR-RFQ-\d{4}-\d+\b/gi, rfq, "another RFQ"],
    [/\bPUR-SQTN-\d{4}-\d+\b/gi, quotation, "another quotation"],
    [/\bLDC\d{4}-\d+\b/gi, award, "another award"],
    [/\bPUR-ORD-\d{4}-\d+\b/gi, po, po ? "another Purchase Order" : "an unrelated Purchase Order"],
  ];
  // Underscores are word characters, so normalize only the preceding separator
  // before recognizing the ERP DocName in generated document filenames.
  for (const [pattern, expected, reason] of references) {
    const identifiers = label.replaceAll("_", " ").match(pattern) || [];
    if (identifiers.some(identifier => identifier.toLowerCase() !== expected.toLowerCase())) return reason;
  }
  return "";
}

export function resolveDocumentType(sourceDoctype: string, file: ClmRecord): string {
  const name = text(file.file_name).toLowerCase();
  const field = text(file.attached_to_field).toLowerCase();
  if (sourceDoctype === "Purchase Order" || /\bpur[_-]ord\b/i.test(name) || name.startsWith("po_") || name.startsWith("po-")) {
    return "Purchase Order";
  }
  if (sourceDoctype === "Legal Document Review") {
    if (field.includes("terms") || name.includes("terms")) return "Award Terms & Conditions";
    if (field.includes("warranty") || field.includes("warenty") || name.includes("warranty")) return "Award Warranty Certificate";
    if (field.includes("insurance") || name.includes("insurance")) return "Award Insurance Certificate";
    if (field.includes("esign") || field.includes("signed") || name.includes("signed")) return "Award Signed Document";
    return "Award Documentation";
  }
  if (sourceDoctype === "Supplier Quotation") {
    if (field.includes("terms") || name.includes("terms")) return "Terms & Conditions";
    if (field.includes("warranty") || field.includes("warenty") || name.includes("warranty")) return "Warranty Certificate";
    if (field.includes("insurance") || name.includes("insurance")) return "Insurance Certificate";
    return "Supplier Quotation Attachment";
  }
  if (sourceDoctype === "Request for Quotation" || sourceDoctype === "Request for Quotation Item" || sourceDoctype === "Material Request Item") {
    if (field.includes("drawing") || name.includes("drawing") || name.endsWith(".dwg") || name.endsWith(".dxf")) return "Engineering Drawing";
    if (field.includes("spec") || name.includes("spec")) return "RFQ Specification";
    return "RFQ Supporting Document";
  }
  return "Supporting Document";
}

/**
 * Read attachment references from the verified award only. No file is copied,
 * no URL gains permissions, and global Supplier attachments are never queried.
 */
export async function collectRfqAwardDocuments(input: {
  rfq: ClmRecord; quotation: ClmRecord; review?: ClmRecord; supplier: ClmRecord; po?: ClmRecord;
}, deps: ClmDeps): Promise<{ documents: RfqClmSourceDocument[]; warnings: string[]; filePaths: Record<string, string> }> {
  return collectRfqDocuments(input, deps, true);
}
/** Before an award exists, collect only this RFQ's verified engineering lineage. */
export async function collectInitialRfqDocuments(rfq: ClmRecord, deps: ClmDeps) {
  return collectRfqDocuments({ rfq }, deps, false);
}
async function collectRfqDocuments(input: { rfq: ClmRecord; quotation?: ClmRecord; review?: ClmRecord; supplier?: ClmRecord; po?: ClmRecord }, deps: ClmDeps, awarded: boolean): Promise<{ documents: RfqClmSourceDocument[]; warnings: string[]; filePaths: Record<string, string> }> {
  const { rfq, quotation, review, supplier, po } = input;
  const rfqName = text(rfq.name), quotationName = text(quotation?.name), awardName = text(review?.name), poName = text(po?.name);
  if (!rfqName || awarded && (!quotation || !supplier || !quotationName || !text(supplier.name) || quotation.supplier !== supplier.name ||
    ![quotation, ...rows(quotation.items)].some(row => row.request_for_quotation === rfqName) ||
    review && (review.rfq_name !== rfqName || review.sq_name !== quotationName))) {
    throw new ClmError("Cannot collect documents for an inconsistent RFQ award.", 409);
  }
  const warnings = new Set<string>();
  const sources: Source[] = [
    { doctype: "Request for Quotation", record: rfq, paths: engineeringPaths(rfq) },
    ...(quotation ? [{ doctype: "Supplier Quotation", record: quotation, paths: fieldsPaths(quotation, quotationFields) }] : []),
    ...(po && text(po.name) ? [{ doctype: "Purchase Order", record: po, paths: fieldsPaths(po, ["custom_contract_document", "custom_executed_contract"]) }] : []),
  ];
  if (review) {
    const paths = fieldsPaths(review, reviewFields);
    let envelope: ClmRecord = {};
    try { envelope = typeof review.esign_envelope === "string" ? JSON.parse(review.esign_envelope) : review.esign_envelope as ClmRecord || {}; }
    catch { /* Invalid signature metadata is not evidence of another attachment. */ }
    for (const document of Object.values(envelope?.documents || {}) as ClmRecord[]) {
      if (document && document.signedFileId && pathOf(document.signedFileUrl)) paths.add(pathOf(document.signedFileUrl));
    }
    sources.push({ doctype: "Legal Document Review", record: review, paths });
  }

  // RFQ creation preserves engineering document references on line items and
  // their Material Request lineage. Only follow the exact persisted row links.
  const materialRequests = new Map<string, ClmRecord | null>();
  for (const item of rows(rfq.items)) {
    if (text(item.name)) sources.push({ doctype: "Request for Quotation Item", record: item, paths: engineeringPaths(item) });
    const mrName = text(item.material_request), mrItem = text(item.material_request_item);
    if (!mrName || !mrItem) continue;
    if (!materialRequests.has(mrName)) {
      try { materialRequests.set(mrName, await deps.load("Material Request", mrName)); }
      catch (error) {
        if (!(error instanceof ClmError) || ![403, 404].includes(error.status)) throw error;
        materialRequests.set(mrName, null);
        warnings.add(`Supporting documents from Material Request ${mrName} could not be verified.`);
      }
    }
    const request = materialRequests.get(mrName);
    const row = request?.name === mrName && Number(request.docstatus) === 1
      ? rows(request.items).find(candidate => candidate.name === mrItem && candidate.item_code === item.item_code) : undefined;
    if (row) sources.push({ doctype: "Material Request Item", record: row, paths: engineeringPaths(row) });
  }

  const uniqueSources = [...new Map(sources.map(source => [`${source.doctype}/${source.record.name}`, source])).values()];
  const listed = await Promise.all(uniqueSources.map(async source => ({ source, files: await deps.list("File", [
    ["attached_to_doctype", "=", source.doctype], ["attached_to_name", "=", text(source.record.name)], ["is_folder", "=", 0],
  ]) })));
  const documents: RfqClmSourceDocument[] = [];
  const filePaths: Record<string, string> = {};
  const ids = new Set<string>(), paths = new Set<string>(), hashes = new Set<string>();
  const verifiedOrders = new Map<string, ClmRecord | null>();
  if (po && text(po.name)) {
    verifiedOrders.set(text(po.name).toUpperCase(), po);
  }
  const verifyOrder = async (poId: string): Promise<ClmRecord | null> => {
    const cleanId = poId.toUpperCase();
    if (!verifiedOrders.has(cleanId)) {
      try {
        const order = await deps.load("Purchase Order", cleanId);
        const valid = order && text(order.name).toUpperCase() === cleanId &&
          Number(order.docstatus) !== 2 &&
          (!supplier?.name || text(order.supplier) === text(supplier.name)) &&
          (!rfq.company || !text(order.company) || text(order.company) === text(rfq.company)) &&
          (rows(order.items).some(row => text(row.supplier_quotation) === quotationName) || text(order.supplier_quotation) === quotationName);
        verifiedOrders.set(cleanId, valid ? order : null);
      } catch {
        verifiedOrders.set(cleanId, null);
      }
    }
    return verifiedOrders.get(cleanId) ?? null;
  };

  for (const { source, files } of listed) {
    // Prefer a current explicit Attach-field row when duplicate File records
    // share bytes. All candidates must still match this exact source parent.
    files.sort((left, right) => Number(Boolean(right.attached_to_field)) - Number(Boolean(left.attached_to_field)) || text(left.name).localeCompare(text(right.name)));
    for (const file of files) {
      const id = text(file.name), path = pathOf(file.file_url), hash = text(file.content_hash);
      if (!id || !path || Number(file.is_folder) || file.attached_to_doctype !== source.doctype || file.attached_to_name !== source.record.name) continue;
      let actualDoctype = source.doctype;
      let actualName = text(source.record.name);
      if (source.doctype === "Supplier Quotation" && (/\bpo[_-]/i.test(text(file.file_name)) || /\bpurchase[_-]?order/i.test(text(file.file_name)) || /\bpur[_-]ord\b/i.test(text(file.file_name)))) {
        const poMatch = `${text(file.file_name)} ${path}`.match(/\b(PUR-ORD-\d{4}-\d+)\b/i);
        const candidatePoId = poMatch ? poMatch[1] : (poName || text(quotation?.purchase_order));
        const verifiedPo = candidatePoId ? await verifyOrder(candidatePoId) : null;
        if (verifiedPo) {
          actualDoctype = "Purchase Order";
          actualName = text(verifiedPo.name);
        } else {
          warnings.add(`Excluded ${text(file.file_name) || id}: Purchase Order documents cannot be labeled as Supplier Quotation attachments.`);
          continue;
        }
      }
      const reason = unrelatedFile(file, rfqName, quotationName, awardName, actualDoctype === "Purchase Order" ? actualName : poName);
      if (reason) {
        warnings.add(`Excluded ${text(file.file_name) || id}: it identifies ${reason}, not a supporting document for this award.`);
        continue;
      }
      // An arbitrary File attachment is not enough to establish its purpose.
      // Referenced current document slots/engineering metadata establish that.
      const referenced = source.paths.has(path) || source.doctype === "Supplier Quotation" && !!review && fieldsPaths(review, reviewFields).has(path) || actualDoctype === "Purchase Order" || source.doctype === "Purchase Order";
      if (!referenced) {
        warnings.add(`Excluded ${text(file.file_name) || id}: its procurement purpose is not recorded on this RFQ award.`);
        continue;
      }
      if (ids.has(id) || paths.has(path) || hash && hashes.has(hash)) {
        ids.add(id); paths.add(path); if (hash) hashes.add(hash);
        continue;
      }
      ids.add(id); paths.add(path); if (hash) hashes.add(hash);
      const docType = resolveDocumentType(actualDoctype, file);
      documents.push({
        file_id: id,
        file_name: text(file.file_name) || id,
        file_url: path,
        document_type: docType,
        source_doctype: actualDoctype,
        source_name: actualName,
        source_path: `/sourcing/rfq/${encodeURIComponent(rfqName)}`,
        status: path ? "Available" : "Unavailable",
      });
      filePaths[id] = path;
    }
  }
  // Used only server-side to bind a later File read to this verified snapshot.
  return { documents, warnings: [...warnings], filePaths };
}
