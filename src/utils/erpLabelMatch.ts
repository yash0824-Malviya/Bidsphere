/**
 * Case-insensitive / fuzzy label matching against ERP master values.
 * Used by Item Import for Procurement Category, Item Group, UOM, Warehouse.
 */

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Lowercase, trim, collapse spaces, strip trailing plural "s". */
export function normalizeErpLabel(value: string): string {
  let s = collapseWhitespace(value).toLowerCase();
  // Common plural → singular for category-style labels ("Raw Materials" → "raw material")
  if (s.endsWith("s") && s.length > 3 && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  return s;
}

/** Stricter key without plural folding — for exact CI match. */
export function normalizeErpLabelExact(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

export type ErpLabelMatchResult =
  | { ok: true; value: string; kind: "exact" | "ci" | "normalized" }
  | { ok: false; suggestions: string[] };

/**
 * Resolve a user-entered label against ERP canonical values.
 * - exact (case/space insensitive)
 * - normalized (plural/singular style)
 * - if multiple normalized matches → error with suggestions
 * - if none → error with closest suggestions
 */
export function matchErpLabel(
  input: string,
  candidates: readonly string[],
): ErpLabelMatchResult {
  const raw = collapseWhitespace(input);
  if (!raw) return { ok: false, suggestions: [] };
  if (candidates.length === 0) return { ok: false, suggestions: [] };

  // 1) Exact (case-sensitive after trim)
  const exact = candidates.find((c) => c === raw);
  if (exact) return { ok: true, value: exact, kind: "exact" };

  // 2) Case-insensitive exact
  const ciKey = normalizeErpLabelExact(raw);
  const ciMatches = candidates.filter(
    (c) => normalizeErpLabelExact(c) === ciKey,
  );
  if (ciMatches.length === 1) {
    return { ok: true, value: ciMatches[0], kind: "ci" };
  }
  if (ciMatches.length > 1) {
    return { ok: false, suggestions: ciMatches };
  }

  // 3) Normalized (plural-insensitive) — only when unique
  const normKey = normalizeErpLabel(raw);
  const normMatches = candidates.filter(
    (c) => normalizeErpLabel(c) === normKey,
  );
  if (normMatches.length === 1) {
    return { ok: true, value: normMatches[0], kind: "normalized" };
  }
  if (normMatches.length > 1) {
    return { ok: false, suggestions: normMatches };
  }

  // 4) Contains / mutual includes on normalized keys (unique only)
  const soft = candidates.filter((c) => {
    const cn = normalizeErpLabel(c);
    return (
      cn.includes(normKey) ||
      normKey.includes(cn) ||
      normalizeErpLabelExact(c).includes(ciKey) ||
      ciKey.includes(normalizeErpLabelExact(c))
    );
  });
  if (soft.length === 1) {
    return { ok: true, value: soft[0], kind: "normalized" };
  }
  if (soft.length > 1) {
    return { ok: false, suggestions: soft.slice(0, 8) };
  }

  // Nearest suggestions by shared prefix / substring
  const suggestions = candidates
    .filter((c) => {
      const cn = normalizeErpLabel(c);
      return (
        cn.startsWith(normKey.slice(0, 4)) ||
        normKey.startsWith(cn.slice(0, 4)) ||
        cn.includes(normKey.slice(0, 6))
      );
    })
    .slice(0, 5);

  return { ok: false, suggestions };
}

export function formatUnknownErpLabelError(
  label: string,
  fieldLabel: string,
  match: Extract<ErpLabelMatchResult, { ok: false }>,
): string {
  const trimmed = collapseWhitespace(label);
  if (match.suggestions.length === 1) {
    return (
      `Unknown ${fieldLabel}: "${trimmed}". Did you mean: "${match.suggestions[0]}"?`
    );
  }
  if (match.suggestions.length > 1) {
    return (
      `Unknown ${fieldLabel}: "${trimmed}". Ambiguous match — did you mean one of: ` +
      match.suggestions.map((s) => `"${s}"`).join(", ") +
      "?"
    );
  }
  return `Unknown ${fieldLabel}: "${trimmed}". It was not found.`;
}
