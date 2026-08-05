/**
 * Authenticated fetch for BidSphere custom APIs (`/api/*` server routes).
 */
import { readErpProxyAccessToken } from "./accessToken";
import {
  API_TIMEOUT_MS,
  logFailedApiRequest,
  MAX_NETWORK_RETRIES,
  sleep,
} from "./apiReliability";

export type BidsphereApiFetchInit = RequestInit & {
  json?: unknown;
  timeoutMs?: number;
};

function isRetryableFetchStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const msg = err.message.toLowerCase();
  return /network|failed to fetch|timeout|aborted/i.test(msg);
}

export async function bidsphereApiFetch(
  path: string,
  init: BidsphereApiFetchInit = {},
): Promise<Response> {
  const { json, headers: initHeaders, body, timeoutMs, ...rest } = init;
  const headers = new Headers(initHeaders);

  if (json !== undefined && body === undefined) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const token = readErpProxyAccessToken();
  if (token) {
    headers.set("X-Bidsphere-Access-Token", token);
  }

  const timeout = timeoutMs ?? API_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(path, {
        ...rest,
        headers,
        credentials: rest.credentials ?? "include",
        signal: controller.signal,
        body: json !== undefined ? JSON.stringify(json) : body,
      });

      if (
        !response.ok &&
        isRetryableFetchStatus(response.status) &&
        attempt < MAX_NETWORK_RETRIES
      ) {
        logFailedApiRequest(
          Object.assign(new Error(`HTTP ${response.status} ${path}`), {
            response: { status: response.status },
          }),
          { context: "bidsphereApiFetch.retry", retryCount: attempt },
        );
        await sleep(1000 * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        let responseBody: unknown = null;
        try {
          responseBody = await response.clone().json();
        } catch {
          try {
            responseBody = await response.clone().text();
          } catch {
            /* ignore */
          }
        }
        logFailedApiRequest(
          Object.assign(new Error(`HTTP ${response.status} ${path}`), {
            response: { status: response.status, data: responseBody },
          }),
          { context: "bidsphereApiFetch", retryCount: attempt },
        );
      }

      return response;
    } catch (err) {
      lastError = err;
      if (isRetryableFetchError(err) && attempt < MAX_NETWORK_RETRIES) {
        // eslint-disable-next-line no-console
        console.warn("[bidsphereApiFetch] retry", {
          path,
          attempt: attempt + 1,
          reason: err instanceof Error ? err.message : String(err),
        });
        await sleep(1000 * (attempt + 1));
        continue;
      }
      logFailedApiRequest(err, {
        context: "bidsphereApiFetch",
        retryCount: attempt,
      });
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  logFailedApiRequest(lastError, { context: "bidsphereApiFetch.exhausted" });
  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed after retries.");
}
