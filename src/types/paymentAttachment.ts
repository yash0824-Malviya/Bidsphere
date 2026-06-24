export type PaymentAttachmentKind =
  | "check_image"
  | "remittance_advice"
  | "payment_confirmation";

export interface PaymentAttachment {
  id: string;
  kind: PaymentAttachmentKind;
  fileName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  objectUrl?: string;
}

export const PAYMENT_ATTACHMENT_KIND_LABELS: Record<
  PaymentAttachmentKind,
  string
> = {
  check_image: "Cheque Image",
  remittance_advice: "Remittance Advice",
  payment_confirmation: "Payment Confirmation",
};
