/** Professional typed-signature fonts for Legal e-sign. */

export type LegalSignatureFontId =
  | "great-vibes"
  | "dancing-script"
  | "pacifico"
  | "allura"
  | "satisfy";

export interface LegalSignatureFont {
  id: LegalSignatureFontId;
  label: string;
  /** CSS font-family stack */
  family: string;
}

export const LEGAL_SIGNATURE_FONTS: LegalSignatureFont[] = [
  {
    id: "great-vibes",
    label: "Classic Script",
    family: '"Great Vibes", "Segoe Script", cursive',
  },
  {
    id: "dancing-script",
    label: "Dancing Script",
    family: '"Dancing Script", "Segoe Script", cursive',
  },
  {
    id: "pacifico",
    label: "Pacifico",
    family: '"Pacifico", "Segoe Script", cursive',
  },
  {
    id: "allura",
    label: "Allura",
    family: '"Allura", "Segoe Script", cursive',
  },
  {
    id: "satisfy",
    label: "Satisfy",
    family: '"Satisfy", "Segoe Script", cursive',
  },
];

export const DEFAULT_SIGNATURE_FONT_ID: LegalSignatureFontId = "great-vibes";

export function getSignatureFont(
  id: string | undefined | null,
): LegalSignatureFont {
  return (
    LEGAL_SIGNATURE_FONTS.find((f) => f.id === id) ?? LEGAL_SIGNATURE_FONTS[0]
  );
}
