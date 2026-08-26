export type MultipartProxyPolicy = "inspect" | "authenticated-upload" | "reject";

/** Generic Frappe RPCs may not hide document arguments in multipart fields. */
export function multipartProxyPolicy(
  apiPath: string,
  contentType: unknown,
): MultipartProxyPolicy {
  const isUpload = apiPath.replace(/^\/+/, "") === "method/upload_file";
  const isMultipart = String(contentType ?? "")
    .toLowerCase()
    .includes("multipart/form-data");
  if (isUpload) return isMultipart ? "authenticated-upload" : "reject";
  return isMultipart ? "reject" : "inspect";
}
