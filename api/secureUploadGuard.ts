const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_TEXT_FIELDS = new Set([
  "is_private",
  "doctype",
  "docname",
  "attached_to_doctype",
  "attached_to_name",
  "fieldname",
  "attached_to_field",
  "folder",
]);

const ECR_ATTACHMENT_FIELDS = new Set([
  "engineering_drawing",
  "3d_cad_file",
  "specification",
  "supporting_documents",
  "validation_documents",
]);

export class SecureUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SecureUploadError";
    this.status = status;
  }
}

export interface ParsedSecureUpload {
  doctype: string;
  docname: string;
  fieldname: string;
  fileName: string;
  fileSize: number;
  fields: Record<string, string>;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export async function parseSecureUpload(
  rawBody: Uint8Array,
  contentType: string,
): Promise<ParsedSecureUpload> {
  if (!contentType.toLowerCase().includes("multipart/form-data") || !/boundary=/i.test(contentType)) {
    throw new SecureUploadError("A valid multipart upload boundary is required.");
  }
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new SecureUploadError("The upload is empty or exceeds the 25 MB limit.", 413);
  }

  let form: FormData;
  try {
    form = await new Request("http://bidsphere.local/upload", {
      method: "POST",
      headers: { "content-type": contentType },
      body: rawBody,
    }).formData();
  } catch {
    throw new SecureUploadError("The multipart upload could not be parsed.");
  }

  const fields: Record<string, string> = {};
  let fileName = "";
  let fileSize = 0;
  let fileCount = 0;
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      if (key !== "file") {
        throw new SecureUploadError(`Unexpected file field '${key}'.`);
      }
      fileCount += 1;
      fileName = clean(value.name);
      fileSize = Number(value.size || 0);
      continue;
    }
    if (!ALLOWED_TEXT_FIELDS.has(key)) {
      throw new SecureUploadError(`Unsupported upload field '${key}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new SecureUploadError(`Duplicate upload field '${key}'.`);
    }
    fields[key] = clean(value);
  }
  if (fileCount !== 1 || !fileName || fileSize <= 0) {
    throw new SecureUploadError("Exactly one non-empty file is required.");
  }
  if (fileSize > MAX_UPLOAD_BYTES) {
    throw new SecureUploadError("The file exceeds the 25 MB upload limit.", 413);
  }

  const doctype = clean(fields.doctype || fields.attached_to_doctype);
  const docname = clean(fields.docname || fields.attached_to_name);
  const fieldname = clean(fields.fieldname || fields.attached_to_field);
  if (
    fields.doctype && fields.attached_to_doctype &&
    fields.doctype !== fields.attached_to_doctype
  ) {
    throw new SecureUploadError("Upload doctype aliases must match.");
  }
  if (
    fields.docname && fields.attached_to_name &&
    fields.docname !== fields.attached_to_name
  ) {
    throw new SecureUploadError("Upload document-name aliases must match.");
  }
  if (
    fields.fieldname && fields.attached_to_field &&
    fields.fieldname !== fields.attached_to_field
  ) {
    throw new SecureUploadError("Upload field aliases must match.");
  }
  if (!doctype || !docname) {
    throw new SecureUploadError(
      "Upload doctype and document name are required so the attachment target can be authorized.",
      403,
    );
  }
  if (fields.is_private && !["0", "1"].includes(fields.is_private)) {
    throw new SecureUploadError("is_private must be 0 or 1.");
  }

  return { doctype, docname, fieldname, fileName, fileSize, fields };
}

export function assertEcrUploadField(fieldname: string): void {
  if (!ECR_ATTACHMENT_FIELDS.has(clean(fieldname))) {
    throw new SecureUploadError(
      "ECR uploads require a supported Engineering or Validation document field.",
      403,
    );
  }
}

/** ECR attachments must never be published or routed into an arbitrary folder. */
export function assertSecureEcrUpload(upload: ParsedSecureUpload): void {
  assertEcrUploadField(upload.fieldname);
  if (upload.fields.is_private !== "1") {
    throw new SecureUploadError("ECR uploads must set is_private=1.", 403);
  }
  const folder = clean(upload.fields.folder);
  if (folder && folder !== "Home") {
    throw new SecureUploadError(
      "ECR uploads may use only the default Home folder.",
      403,
    );
  }
}

export function canonicalSupplierKey(supplier: unknown): string {
  let s = String(supplier ?? "").trim();
  while (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/[.,]+$/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

export function isTemporaryQuotationDocname(docname: string, supplier: string): boolean {
  if (!docname || typeof docname !== "string") return false;
  const lower = docname.trim().toLowerCase();
  if (!lower.startsWith("temp-")) return false;
  const supplierKey = canonicalSupplierKey(supplier);
  if (!supplierKey) return false;
  const docnameKey = canonicalSupplierKey(docname.replace(/^temp-/i, ""));
  return docnameKey.startsWith(supplierKey);
}

export function supplierOwnsUploadTarget(
  supplier: string,
  upload: Pick<ParsedSecureUpload, "doctype" | "docname">,
  document?: Record<string, unknown> | null,
): boolean {
  const expected = canonicalSupplierKey(supplier);
  if (!expected) return false;
  if (!upload.doctype && !upload.docname) return true;
  if (
    upload.doctype === "Supplier Quotation" &&
    isTemporaryQuotationDocname(upload.docname, supplier)
  ) {
    return true;
  }
  if (upload.doctype === "Supplier" && canonicalSupplierKey(upload.docname) === expected) return true;
  if (!document) return false;
  const candidates = [
    document.supplier,
    document.supplier_id,
    document.supplier_name,
  ].map((value) => canonicalSupplierKey(value)).filter(Boolean);
  const supplierRows = Array.isArray(document.suppliers)
    ? (document.suppliers as Array<Record<string, unknown>>)
    : [];
  for (const row of supplierRows) {
    candidates.push(canonicalSupplierKey(row.supplier));
  }
  return candidates.includes(expected);
}
