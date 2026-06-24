import { COMPANY, erpnextClient } from "./erpnext";
import { AI_ASSISTANT_NAME, APP_NAME } from "../config/branding";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Model is configured via env (VITE_ANTHROPIC_MODEL). The default is only a
// safety net so the app still works if the variable is not set.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const ANTHROPIC_MODEL =
  (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined)?.trim() ||
  DEFAULT_ANTHROPIC_MODEL;
const REQUEST_TIMEOUT_MS = 45_000;
const AUTO_RETRY_DELAY_MS = 2_000;
const MAX_ATTEMPTS = 2;

export const AI_BUSY_MESSAGE =
  `${AI_ASSISTANT_NAME} is currently busy. Please try again in a few moments.`;

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export class ProcurementAIError extends Error {
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly statusCode?: number;

  constructor(
    technicalMessage: string,
    options: {
      retryable?: boolean;
      userMessage?: string;
      statusCode?: number;
    } = {}
  ) {
    super(technicalMessage);
    this.name = "ProcurementAIError";
    this.retryable = options.retryable ?? false;
    this.userMessage = options.userMessage ?? AI_BUSY_MESSAGE;
    this.statusCode = options.statusCode;
  }
}

function asList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res;
  if (
    res &&
    typeof res === "object" &&
    "data" in res &&
    Array.isArray((res as { data: T[] }).data)
  ) {
    return (res as { data: T[] }).data;
  }
  return [];
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: { message?: string; type?: string } }).error;
    if (err?.message) return err.message;
    if (err?.type) return err.type;
  }
  return fallback;
}

export function isRetryableAIError(err: unknown): boolean {
  if (err instanceof ProcurementAIError) return err.retryable;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("overloaded") ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("timeout") ||
      msg.includes("503") ||
      msg.includes("529") ||
      msg.includes("too many requests")
    );
  }
  return false;
}

export function getUserFacingAIError(err: unknown): {
  message: string;
  showFallback: boolean;
} {
  if (err instanceof ProcurementAIError) {
    return {
      message: err.userMessage,
      showFallback: err.retryable || err.statusCode !== 401,
    };
  }

  if (err instanceof Error) {
    if (err.message.includes("VITE_ANTHROPIC_API_KEY")) {
      return {
        message:
          `${AI_ASSISTANT_NAME} is not available right now. Please contact your administrator.`,
        showFallback: true,
      };
    }
    if (isRetryableAIError(err)) {
      return { message: AI_BUSY_MESSAGE, showFallback: true };
    }
  }

  return { message: AI_BUSY_MESSAGE, showFallback: true };
}

function classifyHttpError(status: number, body: unknown): ProcurementAIError {
  const technical = extractErrorMessage(body, `HTTP ${status}`);
  const lower = technical.toLowerCase();

  const retryable =
    status === 429 ||
    status === 503 ||
    status === 504 ||
    status === 529 ||
    lower.includes("overloaded") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("timeout") ||
    lower.includes("too many") ||
    lower.includes("capacity") ||
    lower.includes("temporarily unavailable");

  if (status === 401 || status === 403) {
    return new ProcurementAIError(technical, {
      retryable: false,
      userMessage:
        `${AI_ASSISTANT_NAME} authentication failed. Please contact your administrator.`,
      statusCode: status,
    });
  }

  return new ProcurementAIError(technical, {
    retryable,
    userMessage: retryable ? AI_BUSY_MESSAGE : AI_BUSY_MESSAGE,
    statusCode: status,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch ERPNext records relevant to the user's question. */
export async function fetchRelevantData(
  question: string
): Promise<Record<string, unknown>> {
  const q = question.toLowerCase();
  const data: Record<string, unknown> = {};

  try {
    if (
      q.includes("stock") ||
      q.includes("inventory") ||
      q.includes("warehouse") ||
      q.includes("item")
    ) {
      const items = await erpnextClient.get("/api/resource/Item", {
        params: {
          fields: JSON.stringify([
            "name",
            "item_name",
            "item_group",
            "stock_uom",
          ]),
          filters: JSON.stringify([["disabled", "=", 0]]),
          limit_page_length: 50,
        },
      });
      data.items = asList(items);

      const bins = await erpnextClient.get("/api/resource/Bin", {
        params: {
          fields: JSON.stringify([
            "item_code",
            "warehouse",
            "actual_qty",
            "ordered_qty",
            "reserved_qty",
            "projected_qty",
          ]),
          limit_page_length: 100,
          order_by: "actual_qty asc",
        },
      });
      data.stock = asList(bins);
    }

    if (
      q.includes("supplier") ||
      q.includes("vendor") ||
      q.includes("best") ||
      q.includes("rfq")
    ) {
      const suppliers = await erpnextClient.get("/api/resource/Supplier", {
        params: {
          fields: JSON.stringify([
            "name",
            "supplier_name",
            "supplier_group",
            "country",
          ]),
          filters: JSON.stringify([["disabled", "=", 0]]),
          limit_page_length: 50,
        },
      });
      data.suppliers = asList(suppliers);

      const quotes = await erpnextClient.get(
        "/api/resource/Supplier Quotation",
        {
          params: {
            fields: JSON.stringify([
              "name",
              "supplier",
              "grand_total",
              "status",
              "transaction_date",
            ]),
            filters: JSON.stringify([["status", "=", "Submitted"]]),
            limit_page_length: 30,
            order_by: "modified desc",
          },
        }
      );
      data.quotations = asList(quotes);
    }

    if (
      q.includes("rfq") ||
      q.includes("quotation") ||
      q.includes("request") ||
      q.includes("create")
    ) {
      const rfqs = await erpnextClient.get(
        "/api/resource/Request for Quotation",
        {
          params: {
            fields: JSON.stringify(["name", "status", "modified"]),
            limit_page_length: 10,
            order_by: "modified desc",
          },
        }
      );
      data.rfqs = asList(rfqs);
    }

    if (
      q.includes("purchase order") ||
      q.includes(" po") ||
      q.startsWith("po ") ||
      q.includes("order") ||
      q.includes("pending")
    ) {
      const pos = await erpnextClient.get("/api/resource/Purchase Order", {
        params: {
          fields: JSON.stringify([
            "name",
            "supplier",
            "status",
            "grand_total",
            "transaction_date",
            "modified",
          ]),
          limit_page_length: 20,
          order_by: "modified desc",
        },
      });
      data.purchase_orders = asList(pos);
    }

    if (
      q.includes("invoice") ||
      q.includes("payment") ||
      q.includes("overdue") ||
      q.includes("due") ||
      q.includes("pay")
    ) {
      const invoices = await erpnextClient.get(
        "/api/resource/Purchase Invoice",
        {
          params: {
            fields: JSON.stringify([
              "name",
              "supplier",
              "status",
              "grand_total",
              "outstanding_amount",
              "due_date",
              "posting_date",
            ]),
            filters: JSON.stringify([["docstatus", "=", 1]]),
            limit_page_length: 20,
            order_by: "due_date asc",
          },
        }
      );
      data.invoices = asList(invoices);
    }

    if (
      q.includes("spend") ||
      q.includes("budget") ||
      q.includes("cost") ||
      q.includes("amount") ||
      q.includes("total")
    ) {
      const invoices = await erpnextClient.get(
        "/api/resource/Purchase Invoice",
        {
          params: {
            fields: JSON.stringify([
              "name",
              "supplier",
              "grand_total",
              "posting_date",
              "status",
            ]),
            filters: JSON.stringify([["docstatus", "=", 1]]),
            limit_page_length: 50,
            order_by: "posting_date desc",
          },
        }
      );
      data.spend_data = asList(invoices);
    }
  } catch (err) {
    console.warn("[ProcurementAI] Data fetch partial error:", err);
  }

  return data;
}

/** Builds the chat system prompt sent to Claude. */
function buildChatSystemPrompt(erpData: Record<string, unknown>): string {
  return `You are ${APP_NAME}'s AI Procurement Assistant — a helpful, knowledgeable chatbot for the ${APP_NAME} procurement system.

You have access to LIVE data from ERPNext (the organization's ERP system).
Company: ${COMPANY}
Current Date: ${new Date().toLocaleDateString("en-US")}

YOUR CAPABILITIES:
1. Answer questions about stock levels, inventory, warehouses
2. Suggest best suppliers for items based on price history
3. Help create/plan RFQs
4. Show purchase order status
5. Flag overdue invoices and payments
6. Analyze spend patterns
7. Give procurement recommendations

RESPONSE STYLE:
- Be concise but helpful
- Use bullet points and tables when showing data
- Use emojis to make responses friendly (📦 🏭 💰 ✅ ⚠️ etc.)
- Always end with a helpful follow-up suggestion
- If data shows issues (low stock, overdue invoices), highlight them clearly
- Format currency amounts in USD (e.g. $1,000.00)
- When suggesting to create RFQ/PO, give a direct action button text

FORMATTING RULES:
- Use ## for main section headers
- Use ### for sub-headers
- Use | tables | for data (POs, invoices, stock)
- Use • bullets for lists
- Use **bold** for important values like amounts, supplier names
- Use ⚠️ for warnings, ✅ for good status, 🚨 for critical issues
- Keep tables simple — max 5 columns
- For currency always use USD ($) formatting
- Tables must have header row, separator row (|---|), then data rows

CURRENT ERPNEXT DATA:
${JSON.stringify(erpData, null, 2).slice(0, 4000)}

If asked about creating an RFQ, respond with action instructions.
If stock is low (actual_qty < 10), flag it as critical.
If invoice is overdue, calculate days overdue and flag urgency.`;
}

export async function callClaudeWithData(
  question: string,
  erpData: Record<string, unknown>,
  history: ChatHistoryMessage[]
): Promise<{ text: string; data: Record<string, unknown> }> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  if (!apiKey) {
    throw new ProcurementAIError("Missing VITE_ANTHROPIC_API_KEY", {
      retryable: false,
      userMessage:
        `${AI_ASSISTANT_NAME} is not available right now. Please contact your administrator.`,
    });
  }

  const systemPrompt = buildChatSystemPrompt(erpData);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [...history, { role: "user", content: question }],
      }),
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("[ProcurementAI] API error:", {
        status: response.status,
        body,
      });
      throw classifyHttpError(response.status, body);
    }

    const data = body as {
      content?: Array<{ type: string; text?: string }>;
    };

    return {
      text: data.content?.[0]?.text ?? "No response from AI.",
      data: erpData,
    };
  } catch (err) {
    if (err instanceof ProcurementAIError) throw err;

    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[ProcurementAI] Request timed out");
      throw new ProcurementAIError("Request timeout", {
        retryable: true,
        userMessage: AI_BUSY_MESSAGE,
      });
    }

    if (err instanceof TypeError) {
      console.error("[ProcurementAI] Network error:", err);
      throw new ProcurementAIError(err.message, {
        retryable: true,
        userMessage: AI_BUSY_MESSAGE,
      });
    }

    console.error("[ProcurementAI] Unexpected error:", err);
    throw new ProcurementAIError(
      err instanceof Error ? err.message : "Unknown AI error",
      { retryable: true, userMessage: AI_BUSY_MESSAGE }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Calls Claude with one automatic retry after 2s for transient failures. */
export async function callClaudeWithDataResilient(
  question: string,
  erpData: Record<string, unknown>,
  history: ChatHistoryMessage[]
): Promise<{ text: string; data: Record<string, unknown> }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await callClaudeWithData(question, erpData, history);
    } catch (err) {
      lastError = err;
      const canRetry = attempt < MAX_ATTEMPTS - 1 && isRetryableAIError(err);
      console.error(
        `[ProcurementAI] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed:`,
        err
      );
      if (canRetry) {
        await sleep(AUTO_RETRY_DELAY_MS);
        continue;
      }
      break;
    }
  }

  throw lastError;
}
