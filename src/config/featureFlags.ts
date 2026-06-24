/**
 * Application-level feature flags.
 *
 * These flags control UI visibility only — no backend functionality,
 * routes, APIs, or data models are affected.  Disabled modules remain
 * fully accessible via direct URL navigation and continue to function
 * exactly as before.
 *
 * Usage
 * -----
 * import { FEATURE_FLAGS } from "../config/featureFlags";
 * if (FEATURE_FLAGS.showMaterialRequests) { ... }
 *
 * To re-enable a hidden module set its flag to `true` and save.
 * No other code changes are required.
 */
export const FEATURE_FLAGS = {
  /**
   * Show the Material Request module in:
   *   • Sidebar navigation (P2P Core → Material Requests)
   *   • Global search results
   *
   * All routes (/p2p/requisitions, /p2p/requisitions/new, etc.),
   * page components, and backend APIs remain fully functional when
   * this flag is false — the module is only hidden from navigation.
   */
  showMaterialRequests: false,
} as const;
