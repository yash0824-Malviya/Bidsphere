import { generateId } from "./id";
import type {
  PaymentAttachment,
  PaymentAttachmentKind,
} from "../types/paymentAttachment";

export const PAYMENT_ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg";
export const PAYMENT_ATTACHMENT_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

export function isAllowedPaymentAttachment(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (PAYMENT_ATTACHMENT_MIME.includes(mime as (typeof PAYMENT_ATTACHMENT_MIME)[number])) {
    return true;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg";
}

export function formatAttachmentUploadTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAttachmentFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createPaymentAttachment(
  kind: PaymentAttachmentKind,
  file: File
): PaymentAttachment {
  return {
    id: generateId(),
    kind,
    fileName: file.name,
    size: file.size,
    mimeType: file.type || guessMimeFromName(file.name),
    uploadedAt: new Date().toISOString(),
    objectUrl: URL.createObjectURL(file),
  };
}

function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function revokePaymentAttachmentUrl(
  attachment: PaymentAttachment
): void {
  if (attachment.objectUrl) {
    URL.revokeObjectURL(attachment.objectUrl);
  }
}

export function downloadPaymentAttachment(attachment: PaymentAttachment): void {
  if (!attachment.objectUrl) return;
  const anchor = document.createElement("a");
  anchor.href = attachment.objectUrl;
  anchor.download = attachment.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/** Simulated upload for client-side files (no server endpoint yet). */
export function simulateAttachmentUpload(
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isAllowedPaymentAttachment(file)) {
      reject(new Error("Only PDF, PNG, JPG, and JPEG files are allowed."));
      return;
    }

    let pct = 0;
    const interval = window.setInterval(() => {
      pct += 8 + Math.random() * 12;
      if (pct >= 100) {
        window.clearInterval(interval);
        onProgress(100);
        window.setTimeout(resolve, 200);
        return;
      }
      onProgress(Math.min(99, Math.round(pct)));
    }, 60);
  });
}
