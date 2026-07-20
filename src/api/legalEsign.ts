import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type {
  LegalEsignBundle,
  LegalEsignEnvelope,
  LegalEsignPlacement,
  LegalEsignSignature,
} from "../types/legalEsign";
import {
  DEFAULT_SIGNATURE_BOX,
  parseEsignBundle,
  upsertDocEnvelope,
} from "../types/legalEsign";
import type { LegalSignatureFontId } from "../types/legalSignatureFonts";
import { DEFAULT_SIGNATURE_FONT_ID } from "../types/legalSignatureFonts";
import {
  buildLegalSignatureErpFields,
  captureSignatureTimestamp,
} from "../services/digitalSignatureService";
import { uploadFileToERPNext } from "./legalDocsStorage";
import type { LegalDocumentSet } from "./legalDocs";
import { updateLegalDocs } from "./legalDocs";

function localEsignKey(reviewName: string): string {
  return `bidsphere:legal-esign:${reviewName}`;
}

export function readLocalEsignBundle(
  reviewName: string,
): LegalEsignBundle | null {
  try {
    const raw = localStorage.getItem(localEsignKey(reviewName));
    if (!raw) return null;
    return parseEsignBundle(raw);
  } catch {
    return null;
  }
}

export function writeLocalEsignBundle(
  reviewName: string,
  bundle: LegalEsignBundle,
): void {
  try {
    localStorage.setItem(localEsignKey(reviewName), JSON.stringify(bundle));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Merge ERP envelope with local backup (local wins on newer signatures). */
export function resolveEsignBundle(
  reviewName: string | undefined,
  erpRaw: unknown,
): LegalEsignBundle {
  const erp = parseEsignBundle(erpRaw);
  if (!reviewName) return erp;
  const local = readLocalEsignBundle(reviewName);
  if (!local) return erp;
  const merged: LegalEsignBundle = {
    schemaVersion: 2,
    documents: { ...erp.documents },
  };
  for (const key of ["terms", "warranty", "insurance"] as const) {
    const a = erp.documents[key];
    const b = local.documents[key];
    if (!a) {
      if (b) merged.documents[key] = b;
      continue;
    }
    if (!b) {
      merged.documents[key] = a;
      continue;
    }
    const aAt = a.signatures[0]?.signedAt ?? "";
    const bAt = b.signatures[0]?.signedAt ?? "";
    const aAudit = a.auditTrail[a.auditTrail.length - 1]?.at ?? "";
    const bAudit = b.auditTrail[b.auditTrail.length - 1]?.at ?? "";
    const aLatest = aAt > aAudit ? aAt : aAudit;
    const bLatest = bAt > bAudit ? bAt : bAudit;
    merged.documents[key] = bLatest >= aLatest ? b : a;
  }
  return merged;
}

/** SHA-256 hex digest of binary data. */
export async function sha256Hex(
  buffer: ArrayBuffer | Uint8Array,
): Promise<string> {
  const view =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Fresh copy so crypto.subtle always receives a concrete BufferSource.
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function messageForStatus(status: number): string {
  if (status === 401) return "Your ERP session has expired.";
  if (status === 403) return "You do not have permission to view this document.";
  if (status === 404) return "Document not found.";
  if (status >= 500) return "Unable to retrieve the PDF from ERP.";
  return "Unable to retrieve the PDF from ERP.";
}

/** Prefer the exact proxy/ERP message; fall back to status mapping. */
function resolvePdfErrorMessage(
  status: number,
  proxyMessage?: string | null,
  bodyPreview?: string,
): string {
  const preview = (bodyPreview || "").toLowerCase();
  if (
    preview.includes("err_ngrok") ||
    preview.includes("ngrok") && preview.includes("visit this website")
  ) {
    return "Tunnel interstitial blocked the PDF (ngrok). Reload via the app origin or add the skip header.";
  }
  if (proxyMessage?.trim()) return proxyMessage.trim();
  return messageForStatus(status);
}

async function readProxyErrorPayload(res: Response): Promise<{
  message: string | null;
  preview: string;
}> {
  let preview = "";
  try {
    preview = (await res.clone().text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { message: null, preview };
  }
  try {
    const json = JSON.parse(preview || "{}") as {
      success?: boolean;
      message?: string;
      status?: number;
      error?: string;
      detail?: string;
    };
    if (typeof json.message === "string" && json.message.trim()) {
      return { message: json.message.trim(), preview };
    }
    if (typeof json.error === "string" && json.error.trim()) {
      return { message: json.error.trim(), preview };
    }
  } catch {
    /* ignore */
  }
  return { message: null, preview };
}

export async function fetchPdfBytes(proxyUrl: string): Promise<ArrayBuffer> {
  if (!proxyUrl) {
    throw new Error("PDF URL is empty. No file path was provided by the server.");
  }

  console.info("[LegalPdf] Fetching PDF", { url: proxyUrl });

  let res: Response;
  try {
    // access_token is on the query string (see getFullFileUrl). ERP credentials
    // are attached server-side by /api/file-proxy — do not send Desk cookies.
    // `ngrok-skip-browser-warning` bypasses free-tier interstitial HTML/text
    // that otherwise returns HTTP 200 with a non-PDF body (ERR_NGROK_6024).
    res = await fetch(proxyUrl, {
      credentials: "omit",
      headers: {
        Accept: "application/pdf",
        "ngrok-skip-browser-warning": "1",
      },
    });
  } catch (err) {
    console.error("[LegalPdf] Network/CORS error while fetching PDF", {
      url: proxyUrl,
      err,
    });
    throw new Error(
      err instanceof Error
        ? `Network error loading PDF: ${err.message}`
        : "Network error loading PDF (possible CORS failure).",
      { cause: err },
    );
  }

  const contentType = (res.headers.get("content-type") ?? "(none)").toLowerCase();
  console.info("[LegalPdf] Fetch response", {
    url: proxyUrl,
    status: res.status,
    statusText: res.statusText,
    contentType,
  });

  // Only hand bytes to pdf.js when the proxy confirms a PDF.
  if (!res.ok || !contentType.includes("application/pdf")) {
    const { message: fromJson, preview } = await readProxyErrorPayload(res);
    const message = resolvePdfErrorMessage(res.status, fromJson, preview);
    console.error("[LegalPdf] PDF fetch rejected (non-PDF response)", {
      url: proxyUrl,
      status: res.status,
      contentType,
      message,
      preview: preview.slice(0, 300),
    });
    throw new Error(message);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 5) {
    throw new Error("Unable to retrieve the PDF from ERP.");
  }

  const head = new Uint8Array(buf, 0, 5);
  const magic = String.fromCharCode(
    head[0],
    head[1],
    head[2],
    head[3],
    head[4],
  );
  if (!magic.startsWith("%PDF")) {
    const preview = new TextDecoder()
      .decode(new Uint8Array(buf, 0, Math.min(300, buf.byteLength)))
      .replace(/\s+/g, " ");
    console.error("[LegalPdf] Content-Type was PDF but body is not", {
      url: proxyUrl,
      status: res.status,
      contentType,
      magic,
      bytes: buf.byteLength,
      preview,
    });
    throw new Error(
      resolvePdfErrorMessage(res.status, null, preview),
    );
  }

  console.info("[LegalPdf] PDF bytes OK", {
    url: proxyUrl,
    bytes: buf.byteLength,
  });
  return buf;
}

/**
 * Burn a typed signature block into the PDF at the normalized placement.
 * Returns the new PDF bytes (does not mutate the source buffer).
 */
export async function burnTypedSignatureIntoPdf(
  source: ArrayBuffer,
  typedName: string,
  roleLabel: string,
  signedAt: Date,
  placement: LegalEsignPlacement,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const pageIndex = Math.max(0, Math.min(pages.length - 1, placement.page - 1));
  const page = pages[pageIndex];
  const { width, height } = page.getSize();

  const font = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const dateStr = signedAt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = signedAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const boxW = Math.min(
    width * 0.9,
    Math.max(80, (placement.widthNorm || DEFAULT_SIGNATURE_BOX.widthNorm) * width),
  );
  const boxH = Math.min(
    height * 0.4,
    Math.max(40, (placement.heightNorm || DEFAULT_SIGNATURE_BOX.heightNorm) * height),
  );
  const x = Math.max(
    8,
    Math.min(width - boxW - 8, placement.xNorm * width - boxW / 2),
  );
  // PDF coordinates: bottom-left origin. Our yNorm is top-origin.
  const yTop = placement.yNorm * height;
  const y = Math.max(8, Math.min(height - boxH - 8, height - yTop - boxH / 2));

  page.drawRectangle({
    x,
    y,
    width: boxW,
    height: boxH,
    borderColor: rgb(0.15, 0.2, 0.3),
    borderWidth: 0.8,
    color: rgb(1, 1, 1),
    opacity: 0.92,
  });

  const lineY1 = y + boxH - 10;
  const lineY2 = y + 10;
  page.drawLine({
    start: { x: x + 10, y: lineY1 },
    end: { x: x + boxW - 10, y: lineY1 },
    thickness: 0.6,
    color: rgb(0.55, 0.58, 0.62),
  });
  page.drawLine({
    start: { x: x + 10, y: lineY2 },
    end: { x: x + boxW - 10, y: lineY2 },
    thickness: 0.6,
    color: rgb(0.55, 0.58, 0.62),
  });

  page.drawText(typedName, {
    x: x + 14,
    y: y + 42,
    size: 16,
    font,
    color: rgb(0.08, 0.12, 0.2),
    maxWidth: boxW - 28,
  });
  page.drawText(roleLabel, {
    x: x + 14,
    y: y + 28,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(`${dateStr}  ·  ${timeStr}`, {
    x: x + 14,
    y: y + 16,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.38, 0.42),
  });

  return pdf.save({ useObjectStreams: false });
}

export async function verifyDocumentIntegrity(
  currentBytes: ArrayBuffer,
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) return false;
  const hash = await sha256Hex(currentBytes);
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Persist a per-document envelope into the multi-doc bundle on Legal Document Review.
 * Always writes a localStorage backup so signatures survive refresh even if ERP
 * esign_* fields are not provisioned yet.
 */
export async function persistEsignEnvelope(
  reviewName: string,
  envelope: LegalEsignEnvelope,
  options?: {
    signedFile?: { bytes: Uint8Array; fileName: string };
    existingBundle?: LegalEsignBundle | null;
    markDocApproved?: boolean;
  },
): Promise<LegalDocumentSet> {
  const env = { ...envelope };
  let signedUrl = env.signedFileUrl;
  if (options?.signedFile) {
    const blob = new Blob([options.signedFile.bytes as BlobPart], {
      type: "application/pdf",
    });
    const file = new File([blob], options.signedFile.fileName, {
      type: "application/pdf",
    });
    signedUrl = await uploadFileToERPNext(
      file,
      "Legal Document Review",
      reviewName,
    );
    env.signedFileUrl = signedUrl;
    env.signedFileHash = await sha256Hex(options.signedFile.bytes);
  }

  const base =
    options?.existingBundle ??
    resolveEsignBundle(reviewName, null);
  const bundle = upsertDocEnvelope(base, env);
  writeLocalEsignBundle(reviewName, bundle);

  const legalSig = env.signatures.find((s) => s.role === "legal");
  const viewedKey = `${env.documentKey}_viewed` as const;
  const fullUpdates: Partial<LegalDocumentSet> = {
    esign_envelope: JSON.stringify(bundle),
    esign_status: env.status,
    esign_document_hash: env.documentHash,
    esign_signed_file_url: signedUrl ?? "",
    esign_signed_by: legalSig?.reviewerName ?? "",
    esign_signed_on: legalSig?.signedAt
      ? captureSignatureTimestamp(legalSig.signedAt)
      : "",
    [viewedKey]: 1,
  };
  if (legalSig?.signedAt) {
    Object.assign(
      fullUpdates,
      buildLegalSignatureErpFields({
        signedBy: legalSig.reviewerName,
        signedAt: legalSig.signedAt,
        documentHash: env.documentHash,
        signedFileUrl: signedUrl ?? "",
        status: env.status,
        envelopeJson: JSON.stringify(bundle),
      }),
    );
  }
  if (options?.markDocApproved) {
    const docFlagKey = `${env.documentKey}_approved` as const;
    (fullUpdates as Record<string, unknown>)[docFlagKey] = 1;
  }

  try {
    const updated = await updateLegalDocs(reviewName, fullUpdates);
    return {
      ...updated,
      esign_envelope: JSON.stringify(bundle),
      esign_status: env.status,
      esign_signed_by: legalSig?.reviewerName ?? updated.esign_signed_by,
      esign_signed_on: legalSig?.signedAt ?? updated.esign_signed_on,
    };
  } catch (err) {
    console.warn(
      "[LegalEsign] Full envelope persist failed; local backup retained:",
      err,
    );
    try {
      const fallback = await updateLegalDocs(reviewName, {
        [viewedKey]: 1,
      } as Partial<LegalDocumentSet>);
      return {
        ...fallback,
        ...fullUpdates,
      };
    } catch {
      return {
        name: reviewName,
        ...fullUpdates,
      } as LegalDocumentSet;
    }
  }
}

export function envelopeFromLegalDocs(
  docs: LegalDocumentSet | null | undefined,
): LegalEsignEnvelope | null {
  if (!docs) return null;
  const bundle = resolveEsignBundle(docs.name, docs.esign_envelope);
  const keys = ["terms", "warranty", "insurance"] as const;
  for (const k of keys) {
    if (bundle.documents[k]) return bundle.documents[k]!;
  }
  return null;
}

export function newSignatureId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newAuditId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildLegalSignature(input: {
  typedName: string;
  reviewerName: string;
  reviewerId: string;
  placement: LegalEsignPlacement;
  fontId?: LegalSignatureFontId;
  signedAt?: Date;
}): LegalEsignSignature {
  // ERP Datetime format — persisted to `esign_signed_on` (Datetime column).
  const at = captureSignatureTimestamp(input.signedAt ?? new Date());
  return {
    id: newSignatureId(),
    sequence: 1,
    role: "legal",
    reviewerName: input.reviewerName,
    reviewerId: input.reviewerId,
    typedName: input.typedName.trim(),
    fontId: input.fontId ?? DEFAULT_SIGNATURE_FONT_ID,
    signedAt: at,
    placement: {
      ...DEFAULT_SIGNATURE_BOX,
      ...input.placement,
    },
    status: "signed",
  };
}
