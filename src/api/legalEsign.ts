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

/** Pure JS SHA-256 — used when crypto.subtle is unavailable (http://LAN-IP). */
function sha256HexFallback(bytes: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  // high 32 bits of length — fine for inputs under 512MB
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}

function toBytes(buffer: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof buffer === "string") return new TextEncoder().encode(buffer);
  if (buffer instanceof Uint8Array) return buffer;
  return new Uint8Array(buffer);
}

/**
 * SHA-256 hex digest.
 * Uses Web Crypto when available; falls back on insecure origins
 * (e.g. http://10.x.x.x) where crypto.subtle is blocked.
 */
export async function sha256Hex(
  buffer: ArrayBuffer | Uint8Array | string,
): Promise<string> {
  const view = toBytes(buffer);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);

  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const digest = await subtle.digest("SHA-256", copy);
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      /* insecure context / digest rejection → pure JS */
    }
  }
  return sha256HexFallback(copy);
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
