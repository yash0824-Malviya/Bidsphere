import type { QueryClient } from "@tanstack/react-query";
import type { EngineeringChangeRequest } from "../types/erpnext";

/** A failed workflow response can arrive after ERP has committed the change. */
export async function refreshECRQueries(
  client: QueryClient,
  identifiers: Array<string | null | undefined>,
): Promise<void> {
  const names = [...new Set(identifiers.filter((name): name is string => Boolean(name)))];
  const keys: string[][] = [
    ["ecr-list"],
    ["ecr-dashboard"],
    ["ecr-urgent-dashboard-list"],
    ["ecr-badge-counts"],
    ["procurement-team-ecrs-secondary"],
    ["ecr-notifications"],
    ...names.flatMap((name) => [
      ["ecr", name],
      ["ecr-comments", name],
      ["ecr-business-case", name],
    ]),
  ];
  // Refresh failures must not replace the outcome of the attempted action.
  await Promise.allSettled(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/** Read back an already saved ECR without retrying the workflow action. */
export async function recoverECRWorkflowState(
  client: QueryClient,
  identifiers: Array<string | null | undefined>,
  loadRecord: () => Promise<EngineeringChangeRequest>,
): Promise<EngineeringChangeRequest | undefined> {
  const names = new Set(identifiers.filter((name): name is string => Boolean(name)));
  try {
    const persisted = await loadRecord();
    names.add(persisted.name);
    if (persisted.ecr_number) names.add(persisted.ecr_number);
    for (const name of names) client.setQueryData(["ecr", name], persisted);
    return persisted;
  } catch {
    // Preserve the original action error if the follow-up read also fails.
    return undefined;
  } finally {
    await refreshECRQueries(client, [...names]);
  }
}
