import type { VercelRequest } from "@vercel/node";
import { createHash, randomUUID } from "node:crypto";
import type { AccessPrincipal } from "./rbacAuth.js";
import { canReadClm, ClmError, parseClmData } from "./clmCore.js";
import { clmErpRequest, clmResource, createClmDependencies } from "./clmErp.js";
import { authorizeClmUpload } from "./clmGatewayGuard.js";
import { parseSecureUpload } from "./secureUploadGuard.js";
import { readErpAuthConfig } from "./authSession.js";
import type { ClmRecord } from "../src/types/clm.js";
import { fetchErpFile } from "./fileProxyCore.js";
import { clmNow } from "./clmTime.js";

/** Upload provenance is saved by the service, never accepted from the browser. */
export async function uploadClmSupplierEvidence(req: VercelRequest, principal: AccessPrincipal, name: string, modified: string): Promise<ClmRecord> {
  if (principal.typ !== "supplier") throw new ClmError("Supplier authentication is required for negotiation uploads.", 403);
  if (!name || !modified) throw new ClmError("Refresh the Contract before uploading.", 409);
  const record = await clmErpRequest("GET", clmResource("Contract", name));
  if (!canReadClm(principal, "Contract", record)) throw new ClmError("Supplier access is restricted to assigned contracts.", 403);
  const data = parseClmData(record.custom_clm_data);
  if (record.modified !== modified) throw new ClmError("This Contract changed. Refresh before uploading.", 409);
  if (record.custom_contract_status !== "Negotiation") throw new ClmError("Supporting documents can be uploaded during negotiation.", 403);
  const chunks: Buffer[] = []; let size = 0;
  if (req.body !== undefined) {
    if (!Buffer.isBuffer(req.body)) throw new ClmError("A multipart supporting document is required.", 400);
    chunks.push(req.body); size = req.body.length;
  } else for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > 26 * 1024 * 1024) throw new ClmError("The file exceeds the 25 MB limit.", 413);
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  const contentType = String(req.headers["content-type"] || "");
  const upload = await parseSecureUpload(bytes, contentType);
  if (upload.doctype !== "Contract" || upload.docname !== name) throw new ClmError("The upload must belong to this Contract.", 403);
  await authorizeClmUpload(principal, upload, async (doctype, id) => doctype === "Contract" && id === name ? record : clmErpRequest("GET", clmResource(doctype, id)));
  const incoming = await new Request("http://bidsphere.local", { method: "POST", headers: { "Content-Type": contentType }, body: bytes }).formData();
  const file = incoming.get("file");
  if (!(file instanceof Blob)) throw new ClmError("Select a supporting document.", 400);
  const form = new FormData();
  form.append("file", file, upload.fileName); form.append("is_private", "1"); form.append("doctype", "Contract"); form.append("docname", name);
  const config = readErpAuthConfig();
  const response = await fetch(`${config.baseUrl}/api/method/upload_file`, { method: "POST", headers: { Authorization: `token ${config.key}:${config.secret}` }, body: form, signal: AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => ({})) as { message?: ClmRecord };
  if (!response.ok || !result.message?.name) throw new ClmError("The document upload could not be confirmed. Refresh before retrying.", 502);
  const stored = await clmErpRequest("GET", clmResource("File", result.message.name));
  if (stored.name !== result.message.name || !Number(stored.is_private) || stored.attached_to_doctype !== "Contract" || stored.attached_to_name !== name || !String(stored.file_url).startsWith("/private/files/")) throw new ClmError("The private supporting document could not be verified.", 502);
  const sha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const readback = await fetchErpFile({ baseUrl: config.baseUrl, apiKey: config.key, apiSecret: config.secret, filePath: String(stored.file_url), fileId: stored.name,
    authorizeFile: async row => { if (row.name !== stored.name || !Number(row.is_private) || row.attached_to_doctype !== "Contract" || row.attached_to_name !== name) throw new ClmError("The uploaded document does not belong to this Contract.", 403); },
  });
  if (!readback.ok || createHash("sha256").update(readback.buffer).digest("hex") !== sha256) throw new ClmError("The stored supporting document did not match the uploaded file. Refresh before retrying.", 502);
  const at = clmNow();
  const receipt = { file_id: stored.name, file_url: stored.file_url, file_name: stored.file_name || upload.fileName, supplier: principal.supplier, by: principal.sub, at, sha256 };
  data.supplier_uploads = [...(Array.isArray(data.supplier_uploads) ? data.supplier_uploads : []), receipt];
  data.audit.push({ id: randomUUID(), action: "supplier_supporting_document_uploaded", by: principal.sub, at, previous_status: "Negotiation", new_status: "Negotiation", comment: String(receipt.file_name), version: data.version });
  const saved = await createClmDependencies().save("Contract", { ...record, custom_clm_data: JSON.stringify(data) });
  return { ...receipt, modified: saved.modified };
}
