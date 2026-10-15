import { getEngineerEcrNavLabel } from "../../pages/ecr/engineerEcrNavigation";
import { getEngineeringManagerEcrNavLabel } from "../../pages/ecr/engineeringManagerEcrNavigation";

export function isChildNavActive(
  pathname: string,
  search: string,
  to: string,
  label?: string,
  engineerNavigation = false,
  engineeringManagerNavigation = false,
): boolean {
  const [toPath, toQuery = ""] = to.split("?");
  const current = new URLSearchParams(search);

  if (engineerNavigation && (toPath === "/ecr" || toPath === "/ecr/new")) {
    return getEngineerEcrNavLabel(pathname, search) === label;
  }
  if (engineeringManagerNavigation && (toPath === "/ecr" || toPath === "/ecr/new")) {
    return getEngineeringManagerEcrNavLabel(pathname, search) === label;
  }

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

  // Business Intake: Business Cases is active on repository list, detail/edit/new page, or legacy needs paths
  if (toPath === "/intake/business-cases") {
    if (
      pathname === "/intake/business-cases" ||
      pathname.startsWith("/intake/business-cases/") ||
      pathname === "/intake/business-needs" ||
      pathname.startsWith("/intake/business-needs/")
    ) {
      return true;
    }
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
