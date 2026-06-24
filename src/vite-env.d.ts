/// <reference types="vite/client" />

import "jspdf";

declare module "jspdf" {
  interface jsPDF {
    autoPrint: (options?: { variant?: string }) => jsPDF;
    lastAutoTable?: { finalY: number };
  }
}
