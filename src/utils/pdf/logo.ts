import type { jsPDF } from "jspdf";

import { NETLINK_LOGO_PATH } from "../../config/branding";

let logoDataUrl: string | null = null;
let logoAspect = 1;
let logoReady: Promise<void> | null = null;

/** Preload the Netlink logo as a data URL for jsPDF. */
export function ensurePdfLogo(): Promise<void> {
  if (logoDataUrl) return Promise.resolve();
  if (!logoReady) {
    logoReady = fetch(NETLINK_LOGO_PATH)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load Netlink logo.");
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          })
      )
      .then((dataUrl) => {
        logoDataUrl = dataUrl;
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            logoAspect =
              img.naturalHeight > 0
                ? img.naturalWidth / img.naturalHeight
                : 1;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = dataUrl;
        });
      });
  }
  return logoReady;
}

export function drawPdfLogo(
  doc: jsPDF,
  x: number,
  y: number,
  heightMm: number
): { widthMm: number; heightMm: number } {
  const height = heightMm;
  const width = height * logoAspect;

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", x, y, width, height);
    return { widthMm: width, heightMm: height };
  }

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(x, y, width, height, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(Math.min(10, height * 2.2));
  doc.text("N", x + width / 2, y + height / 2 + 1.2, { align: "center" });
  return { widthMm: width, heightMm: height };
}
