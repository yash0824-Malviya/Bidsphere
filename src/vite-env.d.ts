/// <reference types="vite/client" />

declare global {
  const __DEMO_MFA_ENABLED__: boolean;
  const __DEMO_MFA_OTP__: string;
}

export {};

import "jspdf";

declare module "jspdf" {
  interface jsPDF {
    autoPrint: (options?: { variant?: string }) => jsPDF;
    lastAutoTable?: { finalY: number };
  }
}
