/** Bind a Legal PDF request to the persisted review and attachment slot. */
export function getLegalReviewAttachmentUrl(reviewName: string | undefined, documentKey: string, fileUrl: string): string {
  if (!reviewName?.trim() || !fileUrl.trim()) return "";
  let path = fileUrl.trim();
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { return ""; }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (!/^\/(private\/)?files\//.test(path)) return "";
  const query = new URLSearchParams({ path, legal_review: reviewName, document_key: documentKey });
  // The live session is added at fetch time, never embedded in the URL.
  return `/api/file-proxy?${query}`;
}
