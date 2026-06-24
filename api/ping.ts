import type { VercelRequest, VercelResponse } from "@vercel/node";

// TEMPORARY standalone health check (remove once deployment is confirmed).
//
// This is a NON-dynamic function (route: /api/ping). It does not depend on
// the catch-all `api/[...path].ts` route or on ERPNext at all.
//
// Diagnosis after deploy:
//   - /api/ping returns pong, but /api/method/ping 404s
//        → the catch-all route `api/[...path].ts` is not being detected.
//   - BOTH 404
//        → no /api function is deploying at all (check the Vercel project's
//          Root Directory / that the build includes the `api/` folder).
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  console.log("[ping] /api/ping invoked");
  res.status(200).json({ message: "pong", source: "api/ping.ts" });
}
