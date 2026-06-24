import type { jsPDF } from "jspdf";

let fontReady: Promise<void> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Load Roboto once per session for PDF generation. */
export function ensurePdfFont(doc: jsPDF): Promise<void> {
  if (!fontReady) {
    fontReady = fetch("/fonts/Roboto-Regular.ttf")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load PDF font.");
        return res.arrayBuffer();
      })
      .then((buffer) => {
        const base64 = arrayBufferToBase64(buffer);
        doc.addFileToVFS("Roboto-Regular.ttf", base64);
        doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
        doc.addFont("Roboto-Regular.ttf", "Roboto", "bold");
      });
  }
  return fontReady;
}

export function setPdfBodyFont(doc: jsPDF, style: "normal" | "bold" = "normal"): void {
  doc.setFont("Roboto", style);
}
