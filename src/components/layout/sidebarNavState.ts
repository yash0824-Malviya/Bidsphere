export function isChildNavActive(
  pathname: string,
  search: string,
  to: string,
  label?: string,
): boolean {
  const [toPath, toQuery = ""] = to.split("?");
  const current = new URLSearchParams(search);

  // The ECR list normalizes several user-facing queue aliases. Keep the
  // corresponding role-specific sidebar child active for those equivalent
  // URLs instead of comparing raw query strings only.
  if (pathname === "/ecr") {
    const currentFilter = (current.get("filter") || "")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-");
    const queueAliases: Record<string, string[]> = {
      "My ECRs": ["", "mine"],
      "Engineering Review": ["engineering", "eng-review", "pending", "pending-approval"],
      "Procurement Review": ["procurement-review", "procurement"],
      "RFQ Pending": ["rfq-pending", "create-rfq", "rfq-required"],
    };
    if (label && queueAliases[label]?.includes(currentFilter)) return true;
  }

  if (pathname !== toPath) return false;

  if (toQuery) {
    const expected = new URLSearchParams(toQuery);
    for (const [key, value] of expected.entries()) {
      if (current.get(key) !== value) return false;
    }
    return true;
  }

  if (toPath === "/suppliers" && current.get("tab") === "performance") {
    return false;
  }

  // `/ecr` is the unfiltered "all/my ECRs" child. Role queue links share
  // the same path with a filter, so only the matching queue should be active.
  if (toPath === "/ecr" && current.has("filter")) return false;

  return true;
}
