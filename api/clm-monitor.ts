import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runClmMonitoring } from "./clmNotifications.js";
import { ClmError } from "./clmCore.js";

/** Scheduled operational reminders; never approves or signs a Contract. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).json({ message: "Method Not Allowed." }); return; }
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(typeof req.headers.authorization === "string" ? req.headers.authorization : "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ message: "Monitoring authorization is required." }); return; }
  try { res.status(200).json({ data: await runClmMonitoring() }); }
  catch (error) { res.status(error instanceof ClmError ? error.status : 500).json({ message: error instanceof ClmError ? error.message : "Contract monitoring failed. Review the server configuration and retry." }); }
}
