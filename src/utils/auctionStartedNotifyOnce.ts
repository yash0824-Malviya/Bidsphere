/**
 * Persist which auctions already fired the "Auction Started" notification
 * for a supplier — prevents replay on refresh / navigation / dashboard return.
 */

function storeKey(supplierId: string): string {
  return `bidsphere.auction-started-notified.${supplierId.trim().toLowerCase()}`;
}

function readSet(supplierId: string): Set<string> {
  if (!supplierId || typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storeKey(supplierId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function writeSet(supplierId: string, set: Set<string>): void {
  if (!supplierId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      storeKey(supplierId),
      JSON.stringify(Array.from(set).slice(-200)),
    );
  } catch {
    /* ignore quota */
  }
}

export function wasAuctionStartedNotified(
  supplierId: string,
  auctionName: string,
): boolean {
  if (!supplierId || !auctionName) return true;
  return readSet(supplierId).has(auctionName);
}

export function markAuctionStartedNotified(
  supplierId: string,
  auctionName: string,
): void {
  if (!supplierId || !auctionName) return;
  const set = readSet(supplierId);
  set.add(auctionName);
  writeSet(supplierId, set);
}
