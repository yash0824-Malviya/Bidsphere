const MIN_SEQUENCE = 201;

/**
 * Extract uppercase initials from an item name.
 * Multi-word: first letter of each word (e.g. "Dell Laptop" → "DL").
 * Single word: first two letters (e.g. "Laptop" → "LA").
 */
export function extractItemInitials(itemName: string): string {
  const trimmed = itemName.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => (w[0] ?? "").toUpperCase()).join("");
  }

  return words[0].slice(0, 2).toUpperCase();
}

/**
 * Generate a unique item code: INITIALS-SEQUENCE (e.g. DL-201).
 *
 * - New prefix: uses the next global sequence (starting at 201).
 * - Existing prefix: increments within that prefix (DL-201 → DL-202).
 */
export function generateItemCode(
  itemName: string,
  existingCodes: Iterable<string>
): string {
  const initials = extractItemInitials(itemName);
  if (!initials) return "";

  const escaped = initials.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixPattern = new RegExp(`^${escaped}-(\\d+)$`, "i");

  let maxPrefixSeq = MIN_SEQUENCE - 1;
  let maxGlobalSeq = MIN_SEQUENCE - 1;
  let hasPrefixMatch = false;

  for (const raw of existingCodes) {
    const code = raw.trim();
    if (!code) continue;

    const globalMatch = code.match(/-(\d+)$/);
    if (globalMatch) {
      maxGlobalSeq = Math.max(maxGlobalSeq, parseInt(globalMatch[1], 10));
    }

    const prefixMatch = code.match(prefixPattern);
    if (prefixMatch) {
      hasPrefixMatch = true;
      maxPrefixSeq = Math.max(maxPrefixSeq, parseInt(prefixMatch[1], 10));
    }
  }

  const nextSeq = hasPrefixMatch
    ? maxPrefixSeq + 1
    : Math.max(MIN_SEQUENCE, maxGlobalSeq + 1);

  return `${initials}-${nextSeq}`;
}
