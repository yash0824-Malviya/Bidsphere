import type { ClmRecord } from "../src/types/clm.js";
import { ClmError, parseClmData } from "./clmCore.js";
import { persistedRfqAwardValue } from "./rfqAwardValue.js";
import { parseRfqMessage } from "../src/utils/rfqMessage.js";
import { canonicalErpFilePath } from "./fileProxyCore.js";

/** Read-only presentation data. This never changes a Contract or its award. */
export interface ContractPdfContext {
  company?: string;
  department?: string;
  supplierName?: string;
  rfqTitle?: string;
  rfqScope?: string;
  rfqValidTill?: string;
  awardId?: string;
  awardValue?: number;
  awardCurrency?: string;
  /** Item scope is from the winning quotation, not an invented award-price allocation. */
  items: Array<{ item: string; qty: number | string; uom: string; itemCode?: string; description?: string; sourceQuotation?: string; sourceQuotationItem?: string }>;
  itemSource?: { doctype: "Supplier Quotation"; name: string; modified?: string };
  /** Captured with the locked PDF so its presentation sources remain auditable. */
  sourceRecords?: Array<{ doctype: string; name: string; modified?: string }>;
  documents: Array<{ name: string; reference?: string; documentType?: string; uploadedAt?: string }>;
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): ClmRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value.map(object).filter(row => Object.keys(row).length > 0) : [];
const mismatch = () => { throw new ClmError("The linked Contract PDF source records disagree. Refresh the Contract and verify its RFQ, award and winning quotation references.", 409); };
const assertSame = (value: unknown, expected: string) => { if (text(value) && text(value) !== expected) mismatch(); };

export async function loadContractPdfContext(
  contract: ClmRecord,
  load: (doctype: string, name: string) => Promise<ClmRecord>,
): Promise<ContractPdfContext> {
  const data = parseClmData(contract.custom_clm_data);
  const context = object(data.rfq_context), source = object(data.rfq_source);
  const result: ContractPdfContext = { items: [], documents: [] };
  const cache = new Map<string, Promise<ClmRecord | undefined>>();
  const read = (doctype: string, name: string): Promise<ClmRecord | undefined> => {
    if (!name) return Promise.resolve(undefined);
    const key = `${doctype}/${name}`;
    if (!cache.has(key)) cache.set(key, load(doctype, name).then(record => {
      if (!record || record.name !== name) mismatch();
      (result.sourceRecords ||= []).push({ doctype, name, ...(text(record.modified) ? { modified: text(record.modified) } : {}) });
      return record;
    }).catch(error => {
      // Optional presentation metadata must not invent a missing source.
      if (error instanceof ClmError && [403, 404].includes(error.status)) return undefined;
      throw error;
    }));
    return cache.get(key)!;
  };
  const rfqId = text(contract.custom_rfq);
  const quotationId = text(contract.custom_supplier_quotation);
  const supplierId = text(contract.custom_supplier) || text(contract.party_name);
  const awardId = text(context.award_id) || text(source.award) || text(source.legal_review);
  if (rfqId) {
    assertSame(context.rfq_id, rfqId); assertSame(source.rfq, rfqId);
    assertSame(context.quotation_id, quotationId); assertSame(source.quotation, quotationId);
    assertSame(context.supplier_id, supplierId); assertSame(source.supplier, supplierId);
    assertSame(source.award, awardId); assertSame(source.legal_review, awardId);
  }
  const [rfq, quotation, request, supplier] = await Promise.all([
    rfqId ? read("Request for Quotation", rfqId) : undefined,
    rfqId && quotationId ? read("Supplier Quotation", quotationId) : undefined,
    rfqId && text(contract.custom_contract_request) ? read("Contract Request", text(contract.custom_contract_request)) : undefined,
    rfqId && supplierId ? read("Supplier", supplierId) : undefined,
  ]);
  result.supplierName = text(supplier?.supplier_name) || undefined;
  if (request) {
    assertSame(request.custom_rfq, rfqId);
    assertSame(request.custom_supplier_quotation, quotationId);
    assertSame(request.supplier, supplierId);
  }
  if (quotation) {
    assertSame(quotation.supplier, supplierId);
    if (!text(quotation.supplier) || ![quotation, ...rows(quotation.items)].some(row => text(row.request_for_quotation) === rfqId)) mismatch();
    if (rfq) assertSame(quotation.company, text(rfq.company));
  }
  if (rfq) {
    const message = parseRfqMessage(text(rfq.message_for_supplier));
    result.rfqTitle = message.title || text(rfq.title) || undefined;
    if (message.body) result.rfqScope = message.body;
    result.rfqValidTill = message.validTill || text(rfq.valid_till) || undefined;
    if (request) assertSame(request.company, text(rfq.company));
    assertSame(source.company, text(rfq.company));
  }
  result.company = text(request?.company) || text(rfq?.company) || text(contract.company) || (!rfqId ? text(source.company) : "") || undefined;
  result.department = text(request?.department) || text(rfq?.department) || text(rfq?.custom_department) || text(source.department) || text(contract.department) || undefined;

  let award: ClmRecord | undefined;
  // Older records may use the quotation itself as the award reference. That is
  // not evidence of a final amount, so never substitute quotation grand_total.
  if (rfq && quotation && awardId && awardId !== quotationId) {
    award = await read("Legal Document Review", awardId);
    if (award) {
      if (award.rfq_name !== rfqId || award.sq_name !== quotationId) mismatch();
      assertSame(award.supplier, supplierId); assertSame(award.company, text(rfq.company));
      const value = persistedRfqAwardValue(award, quotation);
      // The Contract's reviewed amount cannot silently drift when presentation
      // data is fetched for a newly locked version. Never substitute live values.
      const contractValue = contract.custom_contract_value;
      if ((typeof contractValue !== "number" && typeof contractValue !== "string") || String(contractValue).trim() === "" ||
        !Number.isFinite(Number(contractValue)) || Number(contractValue) !== value.amount || text(contract.custom_currency) !== value.currency) {
        throw new ClmError("The Contract value or currency differs from its saved final award. Reconcile the approved Contract before generating its PDF.", 409);
      }
      result.awardId = awardId; result.awardValue = value.amount; result.awardCurrency = value.currency;
    }
  } else if (quotation && awardId === quotationId) result.awardId = awardId;
  if (rfq && quotation) {
    const rfqItems = rows(rfq.items);
    result.itemSource = { doctype: "Supplier Quotation", name: quotationId, ...(text(quotation.modified) ? { modified: text(quotation.modified) } : {}) };
    result.items = rows(quotation.items).filter(row => {
      const rowRfq = text(row.request_for_quotation);
      if (rowRfq) return rowRfq === rfqId;
      if (text(quotation.request_for_quotation) === rfqId) return true;
      const rowId = text(row.request_for_quotation_item);
      return !!rowId && rfqItems.some(item => item.name === rowId && (!text(row.item_code) || item.item_code === row.item_code));
    }).filter(row => (typeof row.qty === "number" || typeof row.qty === "string") && String(row.qty).trim() !== "" && Number.isFinite(Number(row.qty)))
      .map(row => ({ item: text(row.item_name) || text(row.item_code), qty: row.qty as number | string, uom: text(row.uom),
        ...(text(row.item_code) ? { itemCode: text(row.item_code) } : {}),
        ...(text(row.description) ? { description: text(row.description) } : {}),
        sourceQuotation: quotationId,
        ...(text(row.name) ? { sourceQuotationItem: text(row.name) } : {}),
      }))
      .filter(row => !!row.item);
  }

  const evidence: ClmRecord[] = [
    ...rows(data.source_documents).map(row => ({ ...row, doctype: text(row.source_doctype), parent: text(row.source_name) })),
    ...rows(data.supplier_documents).map(row => ({ ...row, doctype: "Contract", parent: text(contract.name) })),
  ];
  const ids = new Set<string>(), paths = new Set<string>(), hashes = new Set<string>();
  const executionFiles = new Set([text(object(data.locked_file).file_id), ...data.signatures.map(row => text(row.file_id))].filter(Boolean));
  for (const row of evidence) {
    const id = text(row.file_id), doctype = text(row.doctype), parent = text(row.parent);
    if (!id || ids.has(id) || executionFiles.has(id)) continue;
    let verifiedParent = doctype === "Contract" && parent === contract.name;
    if (rfq && quotation) {
      verifiedParent ||= doctype === "Request for Quotation" && parent === rfqId ||
        doctype === "Supplier Quotation" && parent === quotationId ||
        doctype === "Legal Document Review" && !!award && parent === awardId ||
        doctype === "Request for Quotation Item" && rows(rfq.items).some(item => item.name === parent);
      if (doctype === "Material Request Item") {
        const lineage = rows(rfq.items).filter(item => item.material_request_item === parent && text(item.material_request));
        for (const item of lineage) {
          const material = await read("Material Request", text(item.material_request));
          verifiedParent ||= !!material && rows(material.items).some(candidate => candidate.name === parent && candidate.item_code === item.item_code);
        }
      }
    }
    if (!verifiedParent) continue;
    const file = await read("File", id);
    if (!file || file.attached_to_doctype !== doctype || file.attached_to_name !== parent || Number(file.is_folder)) continue;
    const path = canonicalErpFilePath(text(file.file_url));
    if (!path || text(row.file_url) && canonicalErpFilePath(text(row.file_url)) !== path) continue;
    const name = text(file.file_name) || text(row.file_name);
    if (!name) continue;
    // A historical attachment slot may itself contain an unrelated upload.
    const label = `${name} ${path}`.replaceAll("_", " ");
    const words = label.replace(/[-_]+/g, " ");
    if (/\b(?:payments?|invoices?|receipts?|remittance)\s+(?:report|register|statement)\b|\bbank\s+statement\b/i.test(words)) continue;
    const foreign = [[/\bPUR-RFQ-\d{4}-\d+\b/gi, rfqId], [/\bPUR-SQTN-\d{4}-\d+\b/gi, quotationId], [/\bLDC\d{4}-\d+\b/gi, awardId]] as const;
    if (rfqId && foreign.some(([pattern, expected]) => (label.match(pattern) || []).some(reference => reference.toLowerCase() !== expected.toLowerCase()))) continue;
    const hash = text(file.content_hash);
    if (paths.has(path) || hash && hashes.has(hash)) continue;
    ids.add(id); paths.add(path); if (hash) hashes.add(hash);
    result.documents.push({ name, reference: `${doctype}: ${parent}`,
      ...(text(file.file_type) ? { documentType: text(file.file_type) } : {}),
      ...(text(file.creation) ? { uploadedAt: text(file.creation) } : {}),
    });
  }
  result.sourceRecords?.sort((a, b) => `${a.doctype}/${a.name}`.localeCompare(`${b.doctype}/${b.name}`));
  return result;
}
