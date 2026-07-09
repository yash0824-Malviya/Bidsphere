/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MFA?: string;
  readonly VITE_COMPANY?: string;
  readonly VITE_ERPNEXT_URL?: string;
  readonly VITE_PROXY_TARGET?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

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
