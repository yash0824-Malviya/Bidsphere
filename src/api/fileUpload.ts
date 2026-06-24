/**
 * ERPNext File Manager upload helper.
 *
 * Uploads files via /api/method/upload_file and returns the file URL.
 * Files are attached to a specific DocType record.
 */

import { erpnext } from "./erpnext";

export interface UploadResult {
  name: string;
  file_name: string;
  file_url: string;
  file_size: number;
  is_private: 0 | 1;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

function validatePdf(file: File): void {
  if (file.type !== "application/pdf") {
    throw new FileValidationError(
      `Only PDF files are accepted. "${file.name}" is ${file.type || "unknown type"}.`
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new FileValidationError(
      `File size ${sizeMB} MB exceeds the 10 MB limit.`
    );
  }
}

/**
 * Upload a PDF file to ERPNext's File Manager, attached to a specific record.
 */
export async function uploadPdf(
  file: File,
  doctype: string,
  docname: string,
  fieldname: string
): Promise<UploadResult> {
  validatePdf(file);

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("doctype", doctype);
  formData.append("docname", docname);
  formData.append("fieldname", fieldname);
  formData.append("is_private", "0");

  const resp = await erpnext.post<{ message: UploadResult }>(
    "/api/method/upload_file",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    }
  );

  const result =
    (resp as unknown as { data?: { message?: UploadResult } })?.data?.message ??
    (resp as unknown as UploadResult);

  // eslint-disable-next-line no-console
  console.log("[FileUpload] Uploaded:", result?.file_name, "→", result?.file_url);

  return result;
}

/**
 * Upload a PDF without attaching to a specific record (for pre-submission uploads).
 * The file is stored in ERPNext File Manager and can be linked later.
 */
export async function uploadPdfUnattached(file: File): Promise<UploadResult> {
  validatePdf(file);

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("is_private", "0");
  formData.append("folder", "Home/Attachments");

  const resp = await erpnext.post<{ message: UploadResult }>(
    "/api/method/upload_file",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    }
  );

  const result =
    (resp as unknown as { data?: { message?: UploadResult } })?.data?.message ??
    (resp as unknown as UploadResult);

  // eslint-disable-next-line no-console
  console.log("[FileUpload] Uploaded (unattached):", result?.file_name, "→", result?.file_url);

  return result;
}
