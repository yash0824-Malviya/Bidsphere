// Diagnostic only: reproduce Vite cache collisions inside an isolated scratch
// directory, then confirm a config-free SSR helper preserves the app's cache.
// Does not authenticate, call ERPNext, or mutate application source or data.
import { createServer } from "vite";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const taskRoot = path.resolve("scratch", `otp-cache-probe-${Date.now()}`);
await mkdir(taskRoot, { recursive: true });
const collisionCache = path.join(taskRoot, "shared-cache");
const metadataFile = path.join(collisionCache, "deps", "_metadata.json");
const servers = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = async (file) => crypto.createHash("sha256").update(await readFile(file)).digest("hex");

try {
  const first = await createServer({
    configFile: false,
    cacheDir: collisionCache,
    define: { __CACHE_PROBE__: "1" },
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime"] },
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
    logLevel: "error",
  });
  servers.push(first);
  await first.listen();
  const deadline = Date.now() + 15000;
  while (!existsSync(metadataFile) && Date.now() < deadline) await pause(100);
  if (!existsSync(metadataFile)) throw new Error("Probe did not finish initial optimization.");
  const firstMetadata = JSON.parse(await readFile(metadataFile, "utf8"));
  const reactInfo = firstMetadata.optimized.react;
  const reactPath = "/" + path.relative(process.cwd(), path.resolve(path.dirname(metadataFile), reactInfo.file)).replaceAll("\\", "/");
  const origin = first.resolvedUrls.local[0].replace(/\/$/, "");
  const firstStatus = (await fetch(`${origin}${reactPath}?v=${firstMetadata.browserHash}`)).status;
  const jsxInfo = firstMetadata.optimized["react/jsx-runtime"];
  const jsxPath = "/" + path.relative(process.cwd(), path.resolve(path.dirname(metadataFile), jsxInfo.file)).replaceAll("\\", "/");
  const originalMetadataHash = await digest(metadataFile);

  // Same defaults, different config (the shape used by config-free diagnostic
  // SSR servers): optimizer invalidates the cache owned by the first server.
  const second = await createServer({
    configFile: false,
    cacheDir: collisionCache,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "silent",
  });
  servers.push(second);
  const afterSecondStarted = existsSync(metadataFile);
  await second.close();
  servers.pop();
  const afterSecondClosed = existsSync(metadataFile);
  const oldDependencyStatus = (await fetch(`${origin}${jsxPath}?v=${firstMetadata.browserHash}`)).status;
  console.log(JSON.stringify({
    check: "isolated-cache-collision",
    isolatedScratchDirectory: taskRoot,
    firstStatus,
    originalMetadataHash,
    afterSecondStarted,
    afterSecondClosed,
    oldDependencyStatus,
  }));

  const appMetadataFile = path.resolve("node_modules/.vite/bidsphere/deps/_metadata.json");
  if (!existsSync(appMetadataFile)) throw new Error("Dedicated app cache is not ready yet.");
  const appBefore = await digest(appMetadataFile);
  const appMetadata = JSON.parse(await readFile(appMetadataFile, "utf8"));
  if (!appMetadata.optimized["framer-motion"]) throw new Error("App cache lacks framer-motion metadata.");
  const pageSource = await (await fetch("http://localhost:5175/src/pages/auth/OtpVerificationPage.tsx")).text();
  const motionPath = pageSource.match(/"([^"\n]*\/framer-motion\.js\?v=[^"]+)"/)?.[1];
  if (!motionPath) throw new Error("Page source did not include an optimized framer-motion URL.");
  const motionUrl = `http://localhost:5175${motionPath}`;
  const motionBefore = (await fetch(motionUrl)).status;
  const helper = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "silent",
  });
  servers.push(helper);
  await helper.ssrLoadModule("/src/utils/authRedirect.ts");
  await helper.close();
  servers.pop();
  const appAfter = await digest(appMetadataFile);
  const motionAfter = (await fetch(motionUrl)).status;
  const unchanged = appBefore === appAfter;
  console.log(JSON.stringify({ check: "dedicated-cache-coexistence", appMetadataUnchanged: unchanged, motionBefore, motionAfter }));
  if (firstStatus !== 200 || oldDependencyStatus !== 504 || !unchanged || motionBefore !== 200 || motionAfter !== 200) process.exitCode = 1;
} finally {
  for (const server of servers.reverse()) await server.close();
}
