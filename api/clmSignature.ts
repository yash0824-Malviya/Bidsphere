import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { clmNow } from "./clmTime.js";
import { PDFDocument } from "pdf-lib";
import { appendClmExecutionPage, generateClmContractPdf, CONTRACT_PDF_TEMPLATE_VERSION } from "./clmContractPdf.js";
import { loadContractPdfContext, type ContractPdfContext } from "./clmContractPdfData.js";
import { currentClmPdfEvidence } from "./clmPdfEvidence.js";
import { readErpAuthConfig } from "./authSession.js";
import { fetchErpFile } from "./fileProxyCore.js";
import { ClmError, clmSnapshotHash, isRfqClmContract, isRfqClmSignatureStage, isRfqClmSupplierSignatureStage, parseClmData, validateClmSignatureInput } from "./clmCore.js";
import { clmErpRequest, clmResource } from "./clmErp.js";
import { burnTypedSignatureIntoPdf } from "../src/utils/legalPdfSignature.js";
import type { LegalEsignPlacement } from "../src/types/legalEsign.js";
import type { ClmRecord, ClmSignature } from "../src/types/clm.js";
import type { AccessPrincipal } from "./rbacAuth.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export interface ClmLockedFile { file_id: string; file_url: string; hash: string; signature_page?: number; version?: string; template_version?: string; pdf_context?: ContractPdfContext }

export async function readClmPdf(contract: ClmRecord, evidence: { file_id?: string; file_url: string; hash?: string }): Promise<Uint8Array> {
  const config = readErpAuthConfig();
  const file = await fetchErpFile({ ...config, apiKey: config.key, apiSecret: config.secret, filePath: evidence.file_url, fileId: evidence.file_id,
    authorizeFile: async row => {
      if (Number(row.is_private) !== 1 || row.is_folder || row.attached_to_doctype !== "Contract" || row.attached_to_name !== contract.name) throw new ClmError("The signing document does not belong to this Contract.", 403);
    },
  });
  if (!file.ok) throw new ClmError("The Contract PDF could not be verified. Open the attachment and retry.", file.status);
  if (file.contentType !== "application/pdf" || file.buffer.subarray(0, 4).toString() !== "%PDF") throw new ClmError("A valid PDF is required for Contract signing.");
  if (evidence.hash && hash(file.buffer) !== evidence.hash) throw new ClmError("The locked Contract document has changed. A new review is required.", 409);
  try {
    const pdf = await PDFDocument.load(file.buffer, { updateMetadata: false });
    if (!pdf.getPageCount()) throw new Error("Empty PDF");
  } catch { throw new ClmError("The Contract PDF cannot be opened for signing. Replace the invalid or encrypted document before approval.", 422); }
  return Uint8Array.from(file.buffer);
}

async function storeClmPdf(contract: ClmRecord, bytes: Uint8Array, suffix: string): Promise<ClmLockedFile> {
  const config = readErpAuthConfig();
  const form = new FormData();
  const digest = hash(bytes);
  form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" }), `${contract.name}-${suffix}-${digest.slice(0, 16)}.pdf`);
  form.append("is_private", "1"); form.append("doctype", "Contract"); form.append("docname", String(contract.name));
  const response = await fetch(`${config.baseUrl}/api/method/upload_file`, { method: "POST", headers: { Authorization: `token ${config.key}:${config.secret}` }, body: form, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({})) as { message?: ClmRecord };
  if (!response.ok || !payload.message?.name || !payload.message.file_url) throw new ClmError("The signed Contract could not be stored privately. Retry without changing the record.", 502);
  const result = { file_id: payload.message.name, file_url: String(payload.message.file_url), hash: digest };
  if (!result.file_url.startsWith("/private/files/")) throw new ClmError("The Contract artifact was not stored as a private file.", 502);
  await readClmPdf(contract, result);
  return result;
}

/** Generate from the reviewed persisted terms, using existing PDF/signature primitives. */
export async function lockClmContract(contract: ClmRecord): Promise<ClmLockedFile> {
  const existing = parseClmData(contract.custom_clm_data);
  if (existing.signatures.length || existing.locked_file || Number(contract.custom_final_version_locked)) {
    throw new ClmError("This Contract version already has immutable PDF evidence. Create a revised version and repeat Legal review before generating a replacement.", 409);
  }
  const version = String(contract.custom_current_version || "1.0");
  if (contract.custom_contract_document) {
    const bytes = await readClmPdf(contract, { file_url: String(contract.custom_contract_document) });
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const signature_page = await appendClmExecutionPage(source, contract);
    return { ...await storeClmPdf(contract, await source.save({ useObjectStreams: false }), `locked-${version}`), signature_page, version, template_version: CONTRACT_PDF_TEMPLATE_VERSION };
  }
  const context = await loadContractPdfContext(contract, (doctype, name) => clmErpRequest("GET", clmResource(doctype, name)));
  let rendered;
  try { rendered = await generateClmContractPdf(contract, context, { forSigning: true }); }
  catch (error) { throw new ClmError(error instanceof Error ? error.message : "The Contract PDF could not be generated."); }
  return { ...await storeClmPdf(contract, rendered.bytes, `locked-${version}`), signature_page: rendered.signature_page, version, template_version: CONTRACT_PDF_TEMPLATE_VERSION, pdf_context: context };
}

export async function signClmContract(contract: ClmRecord, principal: AccessPrincipal, payload: ClmRecord): Promise<ClmSignature> {
  const data = parseClmData(contract.custom_clm_data);
  const optionalSupplier = principal.typ === "supplier" && isRfqClmSupplierSignatureStage(contract, data);
  if (isRfqClmContract(contract) && principal.typ === "supplier" && !optionalSupplier) throw new ClmError("Accept the linked Contract for its submitted Purchase Order before Supplier E-Signature.", 409);
  if (isRfqClmContract(contract) && !isRfqClmSignatureStage(contract, data) && !optionalSupplier) throw new ClmError("This RFQ Contract is not in the E-Signature stage.", 409);
  if (!Number(contract.custom_final_version_locked) || !data.locked_hash || data.approvals.length === 0 || (!optionalSupplier && data.approvals.some(row => row.status !== "Approved"))) throw new ClmError("All required approvals must be completed before signature.");
  const party = principal.typ === "supplier" ? "supplier" : "inteva";
  if (isRfqClmContract(contract) && party === "inteva" && (principal.typ !== "internal" || principal.role !== "legal")) throw new ClmError("Only the designated Legal Manager may sign this RFQ Contract.", 403);
  if (contract.custom_contract_status !== "Pending Signature" && !optionalSupplier) throw new ClmError("This Contract is not awaiting signatures.", 409);
  if (data.locked_hash !== clmSnapshotHash("Contract", contract)) throw new ClmError("The approved Contract version changed. Review is required before signing.", 409);
  const canonicalSupplier = (value: unknown) => String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim().toLowerCase();
  if (principal.typ === "supplier" && (contract.party_type !== "Supplier" || canonicalSupplier(contract.party_name) !== canonicalSupplier(principal.supplier) || contract.custom_supplier && canonicalSupplier(contract.custom_supplier) !== canonicalSupplier(principal.supplier))) throw new ClmError("Supplier access is restricted to assigned contracts.", 403);
  if (data.signatures.some(row => row.party === party)) throw new ClmError("This party has already signed this Contract version.", 409);
  if (data.signatures.some(row => row.version !== String(contract.custom_current_version || data.version)) || data.signatures.length > 1) throw new ClmError("The saved signature evidence does not match the locked Contract version.", 409);
  if (!isRfqClmContract(contract) && party === "inteva" && !data.signatures.some(row => row.party === "supplier")) throw new ClmError("The supplier must sign before the Inteva signatory.");
  if (party === "inteva" && String(contract.custom_inteva_signatory).toLowerCase() !== (principal.typ === "internal" ? principal.email || principal.sub : "").toLowerCase()) throw new ClmError("Only the configured Inteva authorized signatory can sign this Contract.", 403);
  const signatureInput = validateClmSignatureInput(contract, principal, payload);
  const name = signatureInput.typed_name;
  let source;
  try { source = currentClmPdfEvidence(contract, data); }
  catch (error) { throw new ClmError(error instanceof Error ? error.message : "The Contract PDF version could not be verified.", 409); }
  if (!source?.file_id || !source.file_url || !source.hash) throw new ClmError("The locked PDF evidence is missing. A new review is required.", 409);
  const bytes = await readClmPdf(contract, source);
  const sourcePdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const signaturePage = Number((data.locked_file as ClmLockedFile | undefined)?.signature_page);
  if (!Number.isInteger(signaturePage) || signaturePage < 1 || signaturePage > sourcePdf.getPageCount()) throw new ClmError("The locked Contract signature page is missing. Create a new version for review.", 409);
  const at = new Date();
  const placement = payload.placement as LegalEsignPlacement | undefined;
  const position: LegalEsignPlacement = placement || { page: Number(payload.signature_page ?? signaturePage), xNorm: party === "supplier" ? 0.27 : 0.73, yNorm: 0.88, widthNorm: 0.4, heightNorm: 0.11 };
  if (!Number.isInteger(position.page) || position.page < 1 || position.page > sourcePdf.getPageCount() || [position.xNorm, position.yNorm, position.widthNorm, position.heightNorm].some(value => !Number.isFinite(value) || value <= 0 || value > 1)) throw new ClmError("Choose a valid signature position.");
  const left = position.xNorm - position.widthNorm / 2; const right = position.xNorm + position.widthNorm / 2;
  const top = position.yNorm - position.heightNorm / 2; const bottom = position.yNorm + position.heightNorm / 2;
  if (position.page !== signaturePage || position.widthNorm < 0.25 || position.heightNorm < 0.1 || left < 0.05 || right > 0.95 || top < 0.78 || bottom > 0.96 || (party === "supplier" ? right > 0.49 : left < 0.51)) throw new ClmError("Place the signature in your reserved area on the final execution page.");
  const currentVersion = String(contract.custom_current_version || data.version);
  // Visible stamp only; authorization, adopted signature and persistence are unchanged.
  const roleLabel = party === "supplier" ? `SUPPLIER SIGNED | v${currentVersion}` : isRfqClmContract(contract) ? `Legal Manager | SIGNED | v${currentVersion}` : "Inteva authorized signatory";
  let signed: Uint8Array;
  try {
    signed = await burnTypedSignatureIntoPdf(Uint8Array.from(bytes).buffer, name, roleLabel, at, position, async pdf => {
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(await readFile(new URL("../public/fonts/Roboto-Regular.ttf", import.meta.url)), { subset: true });
      return { signature: font, regular: font };
    });
  } catch (error) { throw new ClmError(error instanceof Error ? error.message : "The Contract signature could not be rendered."); }
  const stored = await storeClmPdf(contract, signed, `${party}-signed`);
  const record = await clmErpRequest("GET", clmResource("Contract", String(contract.name)));
  if (record.modified !== contract.modified) throw new ClmError("The Contract changed while signing. Refresh to verify its current signature state.", 409);
  return { ...stored, party, by: principal.typ === "internal" ? principal.email || principal.sub : principal.sub, at: clmNow(at), version: currentVersion, ...signatureInput, request_id: String(payload.request_id || ""), ...(isRfqClmContract(contract) && party === "inteva" ? { role: "legal" } : {}) };
}
