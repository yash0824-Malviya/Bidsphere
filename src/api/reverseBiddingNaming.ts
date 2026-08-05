/**
 * Client helper — ensures Reverse Bidding child DocTypes use hash autoname.
 * Staff-only maintenance call; supplier bids no longer depend on this route.
 */
import { bidsphereApiFetch } from "../utils/bidsphereApiFetch";

let namingEnsured = false;

export async function ensureReverseBiddingChildNaming(
  opts?: { force?: boolean },
): Promise<void> {
  if (namingEnsured && !opts?.force) return;

  const res = await bidsphereApiFetch("/api/reverse-bidding-naming", {
    method: "POST",
  });

  let json: { success?: boolean; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {
      success: false,
      message: `Naming setup failed (HTTP ${res.status}).`,
    };
  }

  if (!res.ok || json.success === false) {
    throw new Error(
      json.message ||
        "Could not configure Reverse Bidding bid history naming in ERPNext.",
    );
  }

  namingEnsured = true;
}

export function resetReverseBiddingNamingCache(): void {
  namingEnsured = false;
}
