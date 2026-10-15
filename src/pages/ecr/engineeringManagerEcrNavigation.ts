export type EngineeringManagerEcrPage = "all-ecrs" | "engineering-review" | "business-cases";

/** Preserve existing ECR URLs while separating the review queue from the listing. */
export function getEngineeringManagerEcrPage(filter?: string | null): EngineeringManagerEcrPage {
  const value = (filter ?? "").trim().toLowerCase().replaceAll("_", "-");
  if (["engineering", "eng-review", "technical-review"].includes(value)) {
    return "engineering-review";
  }
  if (["business-case", "business-case-preparation", "business-case-approved"].includes(value)) {
    return "business-cases";
  }
  return "all-ecrs";
}

/** Used by both the page dispatcher and the Engineering Manager sidebar. */
export function getEngineeringManagerEcrNavLabel(pathname: string, search: string): string | null {
  if (pathname === "/ecr") {
    const page = getEngineeringManagerEcrPage(new URLSearchParams(search).get("filter"));
    if (page === "engineering-review") return "Engineering Review";
    if (page === "business-cases") return "Business Cases";
    return "All ECRs";
  }
  if (pathname === "/ecr/new") return "New ECR";
  if (/^\/ecr\/[^/]+\/business-case\/?$/.test(pathname)) return "Business Cases";
  if (/^\/ecr\/[^/]+\/review\/?$/.test(pathname)) return "Engineering Review";
  if (/^\/ecr\/[^/]+(?:\/edit)?\/?$/.test(pathname)) return "All ECRs";
  return null;
}
