import { useEffect, useState } from "react";
import { Download, ExternalLink, X, FileText, AlertTriangle, Loader2, Image as ImageIcon } from "lucide-react";
import {
  resolveAttachmentUrl,
  detectContentType,
  isImageAttachment,
  isPdfAttachment,
  type AttachmentLike,
} from "../../utils/attachmentResolver";
import type { IntakeAttachment } from "../../types/businessIntake";

export interface BusinessCasePdfPreviewModalProps {
  isOpen: boolean;
  fileName?: string;
  caseId: string;
  documentType?: string;
  directUrl?: string;
  file?: IntakeAttachment | AttachmentLike | null;
  onClose: () => void;
}

export function BusinessCasePdfPreviewModal({
  isOpen,
  fileName = "",
  caseId,
  documentType = "General Supporting Document",
  directUrl,
  file,
  onClose,
}: BusinessCasePdfPreviewModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string>("");
  const [previewType, setPreviewType] = useState<"image" | "pdf" | "unsupported">("pdf");
  const [isPermissionError, setIsPermissionError] = useState(false);

  const activeFileName =
    file?.file_name ||
    file?.fileName ||
    file?.name ||
    fileName ||
    "Supporting Document";

  const activeDocType =
    file?.document_type ||
    file?.category ||
    documentType ||
    "General Supporting Document";

  useEffect(() => {
    if (!isOpen || (!activeFileName && !directUrl && !file)) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        setObjectUrl(null);
      }
      setError(null);
      setIsPermissionError(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setIsPermissionError(false);

    async function loadDocument() {
      try {
        // Resolve authoritative URL using centralized resolver
        const authoritativeUrl = resolveAttachmentUrl(file || directUrl);

        // Candidate URLs in priority order:
        // 1. Authoritative URL from backend/Frappe File record (via file-proxy or direct)
        // 2. Direct URL if passed explicitly
        // 3. Dedicated business case attachment endpoint
        // 4. Static files path if public
        const candidateUrls = Array.from(
          new Set(
            [
              authoritativeUrl,
              directUrl ? resolveAttachmentUrl(directUrl) : "",
              directUrl,
              `/api/business-cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(activeFileName)}/view`,
              file?.file_url ? `/api/file-proxy?path=${encodeURIComponent(file.file_url)}` : "",
            ].filter((u): u is string => Boolean(u && typeof u === "string" && u.trim())),
          ),
        );

        let foundBlob: Blob | null = null;
        let detectedKind: "image" | "pdf" | "unsupported" = "pdf";
        let permissionDenied = false;
        let notFound = false;

        for (const url of candidateUrls) {
          try {
            const resp = await fetch(url, {
              headers: {
                Accept: "image/*,application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
              },
            });

            if (resp.status === 401 || resp.status === 403) {
              permissionDenied = true;
              continue;
            }

            if (resp.status === 404) {
              notFound = true;
              continue;
            }

            if (!resp.ok) {
              continue;
            }

            const headerContentType = resp.headers.get("content-type") || "";
            // Reject HTML fallback pages from SPA routers
            if (headerContentType.includes("text/html")) {
              notFound = true;
              continue;
            }

            const arrayBuffer = await resp.arrayBuffer();
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
              continue;
            }

            const u8 = new Uint8Array(arrayBuffer);

            // 1. Detect image format
            const isPng = u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
            const isJpeg = u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
            const isWebp =
              u8.length >= 12 &&
              u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
              u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50;
            const isGif = u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46;

            const isImageMime =
              headerContentType.startsWith("image/") ||
              isImageAttachment(file || activeFileName) ||
              isPng ||
              isJpeg ||
              isWebp ||
              isGif;

            // 2. Detect PDF format
            const pdfHeader = new TextDecoder().decode(u8.slice(0, 5));
            const isPdf =
              pdfHeader.startsWith("%PDF") ||
              headerContentType.includes("application/pdf") ||
              isPdfAttachment(file || activeFileName);

            if (isImageMime) {
              const mime = isPng
                ? "image/png"
                : isJpeg
                  ? "image/jpeg"
                  : isWebp
                    ? "image/webp"
                    : isGif
                      ? "image/gif"
                      : headerContentType.startsWith("image/")
                        ? headerContentType.split(";")[0]
                        : detectContentType(activeFileName);

              foundBlob = new Blob([arrayBuffer], { type: mime });
              detectedKind = "image";
            } else if (isPdf) {
              foundBlob = new Blob([arrayBuffer], { type: "application/pdf" });
              detectedKind = "pdf";
            } else {
              // Known non-previewable file type (CAD, Excel, Word, ZIP, etc.)
              foundBlob = new Blob([arrayBuffer], {
                type: headerContentType || detectContentType(activeFileName),
              });
              detectedKind = "unsupported";
            }

            const sizeKb = Math.round(foundBlob.size / 1024);
            if (isMounted) {
              setFileSize(sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`);
            }
            break;
          } catch {
            /* try next candidate */
          }
        }

        if (permissionDenied && !foundBlob) {
          if (isMounted) {
            setIsPermissionError(true);
            setError("You don't have permission to view this document.");
            setLoading(false);
          }
          return;
        }

        if (!foundBlob) {
          if (isMounted) {
            setError(
              notFound
                ? "Document could not be found or is no longer available."
                : "Document could not be found or is no longer available.",
            );
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          const url = URL.createObjectURL(foundBlob);
          setObjectUrl(url);
          setPreviewType(detectedKind);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || "Document could not be found or is no longer available.");
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isOpen, activeFileName, caseId, directUrl, file]);

  if (!isOpen) return null;

  const authoritativeDownloadUrl =
    resolveAttachmentUrl(file || directUrl) ||
    `/api/business-cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(activeFileName)}/download`;

  const handleDownload = () => {
    if (objectUrl) {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = activeFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(authoritativeDownloadUrl, "_blank");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-neutral-900/70 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex flex-col w-full max-w-5xl h-[90vh] bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200 bg-neutral-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                previewType === "image"
                  ? "bg-emerald-100 text-emerald-600"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {previewType === "image" ? (
                <ImageIcon className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-neutral-900 truncate max-w-md" title={activeFileName}>
                  {activeFileName}
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-neutral-200/80 text-neutral-700 px-2 py-0.5 rounded-full shrink-0">
                  {activeDocType}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                Business Case <span className="font-mono font-semibold text-neutral-700">{caseId}</span>
                {fileSize && <span> · {fileSize}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {objectUrl && (
              <>
                <a
                  href={objectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 shadow-2xs transition-colors"
                  title="Open in new browser tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New Tab</span>
                </a>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-xs font-semibold text-white hover:bg-primary-700 shadow-2xs transition-colors cursor-pointer"
                  title="Download file"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer Body */}
        <div className="flex-1 bg-neutral-100 relative overflow-hidden flex items-center justify-center p-2 sm:p-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-neutral-600">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
              <p className="text-sm font-medium">Retrieving and preparing document preview...</p>
            </div>
          )}

          {error && !loading && (
            <div className="max-w-md p-6 bg-white rounded-xl border border-red-200 shadow-xs text-center space-y-3">
              <div
                className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
                  isPermissionError ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"
                }`}
              >
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h4 className="text-base font-bold text-neutral-900">Unable to preview document</h4>
              <p className="text-xs text-neutral-600 leading-relaxed">{error}</p>
              <div className="pt-2 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-xs font-semibold text-white hover:bg-primary-700 transition-colors cursor-pointer"
                >
                  Download Directly
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!loading && !error && previewType === "unsupported" && (
            <div className="max-w-md p-6 bg-white rounded-xl border border-neutral-200 shadow-xs text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                <FileText className="h-6 w-6" />
              </div>
              <h4 className="text-base font-bold text-neutral-900">Preview unavailable</h4>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Preview is not available for this file type.
              </p>
              <div className="pt-2 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-xs font-semibold text-white hover:bg-primary-700 transition-colors cursor-pointer"
                >
                  Download File
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {objectUrl && !loading && !error && previewType === "image" && (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-4 bg-neutral-900/5 rounded-xl border border-neutral-200">
              <img
                src={objectUrl}
                alt={activeFileName}
                className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
              />
            </div>
          )}

          {objectUrl && !loading && !error && previewType === "pdf" && (
            <iframe
              src={objectUrl}
              title={activeFileName}
              className="w-full h-full rounded-xl border border-neutral-300 bg-white shadow-inner"
            />
          )}
        </div>
      </div>
    </div>
  );
}
