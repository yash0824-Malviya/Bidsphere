const OWNER_FIELDS = new Set(["ecr_owner", "amended_from", "owner"]);

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(value: unknown): unknown[] {
  const raw = firstValue(value);
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") throw new Error("Invalid ECR filters.");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Invalid ECR filters.");
    return parsed;
  } catch {
    throw new Error("Invalid ECR filters.");
  }
}

function filterField(filter: unknown): string {
  if (!Array.isArray(filter)) return "";
  return String(filter.length >= 4 ? filter[1] : filter[0] ?? "")
    .trim()
    .toLowerCase();
}

export interface EngineerEcrReadScope {
  filters: string;
  orFilters: string;
}

/**
 * Build the authoritative engineer collection scope. Caller-provided owner
 * predicates are removed, then the service-credential query is constrained to
 * all supported ownership fields so migrated and legacy ECRs remain visible.
 */
export function buildEngineerEcrReadScope(
  rawFilters: unknown,
  identity: { email?: string | null; sub?: string | null },
): EngineerEcrReadScope {
  const filters = parseFilters(rawFilters).filter(
    (filter) => !OWNER_FIELDS.has(filterField(filter)),
  );
  const ownerIds = [...new Set(
    [identity.email, identity.sub]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .flatMap((value) => [value, value.toLowerCase()]),
  )];
  if (ownerIds.length === 0) throw new Error("Authenticated engineer identity is required.");

  return {
    filters: JSON.stringify(filters),
    orFilters: JSON.stringify([
      ["ecr_owner", "in", ownerIds],
      ["amended_from", "in", ownerIds],
      ["owner", "in", ownerIds],
    ]),
  };
}
