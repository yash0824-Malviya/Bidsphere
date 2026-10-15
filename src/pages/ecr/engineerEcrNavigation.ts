export type EngineerEcrPage = "my-ecrs" | "technical-review" | "business-cases";

/** Keep existing ECR query URLs while rendering a separate page for each queue. */
export function getEngineerEcrPage(filter?: string | null): EngineerEcrPage {
  const value = (filter ?? "").trim().toLowerCase().replaceAll("_", "-");
  if (["technical-review", "engineering", "eng-review"].includes(value)) {
    return "technical-review";
  }
  if (["business-case", "business-case-preparation", "business-case-approved"].includes(value)) {
    return "business-cases";
  }
  return "my-ecrs";
}

/** Shared by the Engineer page dispatcher and its route-driven sidebar. */
export function getEngineerEcrNavLabel(pathname: string, search: string): string | null {
  if (pathname === "/ecr") {
    const page = getEngineerEcrPage(new URLSearchParams(search).get("filter"));
    if (page === "technical-review") return "Technical Review";
    if (page === "business-cases") return "Business Cases";
    return "My ECRs";
  }
  if (pathname === "/ecr/new") return "New ECR";
  if (/^\/ecr\/[^/]+\/business-case\/?$/.test(pathname)) return "Business Cases";
  if (/^\/ecr\/[^/]+(?:\/(?:edit|review))?\/?$/.test(pathname)) return "My ECRs";
  return null;
}
