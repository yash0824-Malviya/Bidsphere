/** Build enterprise tracking ID: PUR-RFQ-2026-00074-R01 */
export function buildRfqRoundTrackingId(
  rfqName: string,
  roundNumber: number,
): string {
  const padded = String(Math.max(1, roundNumber)).padStart(2, "0");
  return `${rfqName.trim()}-R${padded}`;
}

export function formatRfqRoundLabel(roundNumber: number): string {
  return `R${String(Math.max(1, roundNumber)).padStart(2, "0")}`;
}

export function parseRfqRoundNumberFromTrackingId(
  trackingId: string,
): number | null {
  const match = /-R(\d+)$/i.exec(trackingId.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
