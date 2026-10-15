export { burnTypedSignatureIntoPdf } from "../utils/legalPdfSignature";
import type {
  LegalEsignBundle,
  LegalEsignEnvelope,
  LegalEsignPlacement,
  LegalEsignSignature,
} from "../types/legalEsign";
import {
  DEFAULT_SIGNATURE_BOX,
  parseEsignBundle,
} from "../types/legalEsign";
import type { LegalSignatureFontId } from "../types/legalSignatureFonts";
import { DEFAULT_SIGNATURE_FONT_ID } from "../types/legalSignatureFonts";
import {
  captureSignatureTimestamp,
} from "../services/digitalSignatureService";
import type { LegalDocumentSet } from "./legalDocs";
import { completeLegalSignature } from "./legalDocs";
import { readErpProxyAccessToken } from "../utils/accessToken";

/** ERP is the only workflow/signature source of truth. Never merge browser backups. */
export function resolveEsignBundle(
  _reviewName: string | undefined,
  erpRaw: unknown,
): LegalEsignBundle {
  return parseEsignBundle(erpRaw);
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
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "Your account does not have permission to view this document.";
  if (status === 404) return "Document file could not be found.";
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
  let body = "";
  try {
    body = await res.clone().text();
  } catch {
    /* ignore */
  }
  const preview = body.slice(0, 300);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { message: null, preview };
  }
  try {
    const json = JSON.parse(body || "{}") as {
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

  // Keep ERP service credentials on the server. Move legacy query tokens to
  // the header too, and prefer the current session after a refresh/re-login.
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(proxyUrl, origin);
  const headers: Record<string, string> = { Accept: "application/pdf", "ngrok-skip-browser-warning": "1" };
  if (url.origin === origin && url.pathname === "/api/file-proxy") {
    const token = readErpProxyAccessToken() || url.searchParams.get("access_token");
    url.searchParams.delete("access_token");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  }
  const requestUrl = url.origin === origin ? `${url.pathname}${url.search}` : url.toString();

  let res: Response;
  try {
    res = await fetch(requestUrl, {
      credentials: "omit",
      cache: "no-store",
      headers,
    });
  } catch (err) {
    console.error("[LegalPdf] Network/CORS error while fetching PDF");
    throw new Error("Network error loading PDF (possible CORS failure).", { cause: err });
  }

  const contentType = (res.headers.get("content-type") ?? "(none)").toLowerCase();
  console.info("[LegalPdf] Fetch response", {
    status: res.status,
    statusText: res.statusText,
    contentType,
  });

  // Only hand bytes to pdf.js when the proxy confirms a PDF.
  if (!res.ok || !contentType.includes("application/pdf")) {
    const { message: fromJson, preview } = await readProxyErrorPayload(res);
    const message = resolvePdfErrorMessage(res.status, fromJson, preview);
    console.error("[LegalPdf] PDF fetch rejected (non-PDF response)", {
      status: res.status,
      contentType,
      message,
    });
    throw Object.assign(new Error(message), { status: res.status });
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 5) {
    throw Object.assign(new Error("Document loaded, but the PDF viewer could not display it."), { status: 200 });
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
    console.error("[LegalPdf] Content-Type was PDF but body is not", {
      status: res.status,
      contentType,
      bytes: buf.byteLength,
    });
    throw Object.assign(new Error("Document loaded, but the PDF viewer could not display it."), { status: 200 });
  }

  console.info("[LegalPdf] PDF bytes OK", {
    bytes: buf.byteLength,
  });
  return buf;
}

/**
 * Burn a typed signature block into the PDF at the normalized placement.
 * Returns the new PDF bytes (does not mutate the source buffer).
 */

export async function verifyDocumentIntegrity(
  currentBytes: ArrayBuffer,
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) return false;
  const hash = await sha256Hex(currentBytes);
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

/** Existing signature UI submits intent only; the server validates and burns the approved bytes. */
export async function persistEsignEnvelope(
  reviewName: string,
  envelope: LegalEsignEnvelope,
): Promise<LegalDocumentSet> {
  const signature = envelope.signatures[0];
  if (!signature || !envelope.signatureRequest) {
    throw new Error("Start an authorized signature request first. Executed signatures cannot be deleted.");
  }
  return completeLegalSignature(reviewName, envelope.documentKey, envelope.signatureRequest.id, signature);
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
