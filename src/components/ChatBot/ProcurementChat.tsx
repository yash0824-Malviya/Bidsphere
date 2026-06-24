import { Bot, RefreshCw, Send, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable } from "../../hooks/useDraggable";

import {
  callClaudeWithDataResilient,
  fetchRelevantData,
  getUserFacingAIError,
} from "../../api/procurementChat";
import { AI_ASSISTANT_NAME } from "../../config/branding";
import ChatMessage from "./ChatMessage";

const STORAGE_KEY = "inteva-procurement-chat-v2";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  data?: Record<string, unknown>;
  kind?: "normal" | "error" | "welcome";
  retryQuestion?: string;
  showFallback?: boolean;
}

const WELCOME_CONTENT =
  "Hello! I can help you with RFQs, Suppliers, Purchase Orders, GRNs, Invoices and Payments.";

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: WELCOME_CONTENT,
  timestamp: new Date(),
  kind: "welcome",
};

const QUICK_SUGGESTIONS = [
  "Which items are low on stock?",
  "Show overdue invoices",
  "Show pending purchase orders",
  "Best supplier for laptops?",
  "How much did we spend this month?",
];

export const FALLBACK_ACTIONS = [
  { label: "View RFQs", to: "/sourcing/rfq" },
  { label: "View Purchase Orders", to: "/p2p/purchase-orders" },
  { label: "View Invoices", to: "/p2p/invoices" },
  { label: "Contact Support", to: "/support/help-desk" },
] as const;

function loadStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw) as Array<
      Omit<Message, "timestamp"> & { timestamp: string }
    >;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [WELCOME_MESSAGE];
    }
    return parsed.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return [WELCOME_MESSAGE];
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AssistantAvatar() {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm">
      <Bot className="h-3.5 w-3.5" aria-hidden />
    </div>
  );
}

function FallbackLinks() {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {FALLBACK_ACTIONS.map((action) => (
        <Link
          key={action.to}
          to={action.to}
          className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary-700 transition-colors hover:bg-primary-100"
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  onRetry?: (question: string) => void;
  retrying?: boolean;
}

function MessageBubble({ message, onRetry, retrying }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.kind === "error";

  return (
    <div
      className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"} items-start`}
    >
      {!isUser && <AssistantAvatar />}

      <div
        className={`max-w-[85%] ${
          isUser
            ? "rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-white shadow-sm"
            : isError
            ? "rounded-2xl rounded-tl-sm border border-warning-200 bg-warning-50/90 px-3.5 py-2.5 shadow-sm"
            : "rounded-2xl rounded-tl-sm border border-neutral-100 bg-white px-3.5 py-2.5 shadow-sm"
        }`}
      >
        {isError ? (
          <p className="text-[13px] leading-relaxed text-neutral-800">
            {message.content}
          </p>
        ) : (
          <ChatMessage
            content={message.content}
            variant={isUser ? "user" : "assistant"}
          />
        )}

        {isError && message.retryQuestion && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message.retryQuestion!)}
            disabled={retrying}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
            />
            {retrying ? "Retrying…" : "Retry"}
          </button>
        )}

        {isError && message.showFallback && <FallbackLinks />}

        <p
          className={`mt-1.5 text-[10px] ${
            isUser ? "text-white/60" : "text-neutral-400"
          }`}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

function LoadingBubble({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2">
      <AssistantAvatar />
      <div className="rounded-2xl rounded-tl-sm border border-neutral-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="procurement-chat-dot h-1.5 w-1.5 rounded-full bg-primary"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
          <span className="ml-1.5 text-[11px] text-neutral-500">{label}</span>
        </div>
      </div>
    </div>
  );
}

export default function ProcurementChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Analyzing your request…");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);

  const { dragRef, position, isDragging, onPointerDown, onPointerMove, onPointerUp, wasDrag } = useDraggable();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  useEffect(() => {
    try {
      const persistable = messages.filter((m) => m.kind !== "error");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      /* quota exceeded */
    }
  }, [messages]);

  const runAssistantTurn = useCallback(
    async (question: string, historyMessages: Message[]) => {
      setLoadingLabel("Fetching procurement data…");
      const erpData = await fetchRelevantData(question);

      setLoadingLabel(`${AI_ASSISTANT_NAME} is thinking…`);
      const history = historyMessages
        .filter((m) => m.kind !== "error" && m.kind !== "welcome")
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const response = await callClaudeWithDataResilient(
        question,
        erpData,
        history
      );

      return {
        id: `${Date.now()}-assistant`,
        role: "assistant" as const,
        content: response.text,
        timestamp: new Date(),
        data: response.data,
        kind: "normal" as const,
      };
    },
    []
  );

  const showError = useCallback((question: string, err: unknown) => {
    const { message, showFallback } = getUserFacingAIError(err);

    setMessages((prev) => {
      const withoutError = prev.filter((m) => m.kind !== "error");
      const errorMsg: Message = {
        id: `${Date.now()}-error`,
        role: "assistant",
        content: message,
        timestamp: new Date(),
        kind: "error",
        retryQuestion: question,
        showFallback,
      };
      return [...withoutError, errorMsg];
    });
  }, []);

  const processQuestion = useCallback(
    async (question: string, options?: { appendUser?: boolean }) => {
      const trimmed = question.trim();
      if (!trimmed || processingRef.current) return;

      processingRef.current = true;
      setLoading(true);

      const userMsg: Message = {
        id: `${Date.now()}-user`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
        kind: "normal",
      };

      let workingMessages: Message[] = [];
      setMessages((prev) => {
        const base = prev.filter((m) => m.kind !== "error");
        workingMessages =
          options?.appendUser !== false ? [...base, userMsg] : base;
        return workingMessages;
      });

      if (options?.appendUser !== false) {
        setInput("");
      }

      try {
        const assistantMsg = await runAssistantTurn(trimmed, workingMessages);
        setMessages((prev) => [
          ...prev.filter((m) => m.kind !== "error"),
          assistantMsg,
        ]);
      } catch (err) {
        showError(trimmed, err);
      } finally {
        setLoading(false);
        processingRef.current = false;
      }
    },
    [runAssistantTurn, showError]
  );

  const sendMessage = (text: string) => void processQuestion(text);

  const retryMessage = (question: string) =>
    void processQuestion(question, { appendUser: false });

  const hasOnlyWelcome =
    messages.length === 1 && messages[0]?.kind === "welcome";

  const fabStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    zIndex: 1000,
    touchAction: "none",
    userSelect: "none",
    cursor: isDragging ? "grabbing" : "grab",
    transition: isDragging ? "box-shadow 0.15s" : "box-shadow 0.15s, transform 0.15s",
    boxShadow: isDragging
      ? "0 8px 32px rgba(2,132,199,0.5)"
      : "0 4px 20px rgba(2,132,199,0.4)",
  };

  const chatPanelStyle: React.CSSProperties = (() => {
    const panelW = Math.min(420, window.innerWidth - 32);
    const panelH = Math.min(600, window.innerHeight - 48);
    let left = position.x + 60 - panelW;
    let top = position.y - panelH - 12;
    if (left < 16) left = 16;
    if (left + panelW > window.innerWidth - 16) left = window.innerWidth - panelW - 16;
    if (top < 16) top = position.y + 60 + 12;
    if (top + panelH > window.innerHeight - 16) top = window.innerHeight - panelH - 16;
    return { position: "fixed" as const, left, top, zIndex: 1000, width: panelW, height: panelH };
  })();

  return (
    <>
      <button
        ref={dragRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          onPointerUp(e);
          if (!wasDrag()) setIsOpen(true);
        }}
        className={`procurement-chat-fab flex h-[60px] w-[60px] items-center justify-center rounded-full border-0 bg-primary text-2xl hover:scale-105 ${
          isOpen ? "hidden" : "flex"
        }`}
        style={fabStyle}
        title="AI Procurement Assistant"
        aria-label="Open AI Procurement Assistant"
      >
        🤖
      </button>

      {isOpen && (
        <div
          className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
          style={chatPanelStyle}
        >
          <div className="flex items-center justify-between bg-primary px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  {AI_ASSISTANT_NAME}
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-white/75">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {loading ? "Processing…" : "Online · Powered by Claude"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-surface-page p-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onRetry={retryMessage}
                retrying={loading && msg.kind === "error"}
              />
            ))}

            {loading && <LoadingBubble label={loadingLabel} />}
            <div ref={messagesEndRef} />
          </div>

          {hasOnlyWelcome && !loading && (
            <div className="flex max-h-[100px] flex-wrap gap-1.5 overflow-y-auto border-t border-neutral-100 bg-white px-4 py-2">
              {QUICK_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  disabled={loading}
                  className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary-700 transition-colors hover:bg-primary-100 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 border-t border-neutral-200 bg-white p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask about RFQs, POs, invoices, suppliers…"
              rows={2}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border border-neutral-200 px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-neutral-50 disabled:text-neutral-400"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-white transition-opacity hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes procurement-chat-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        .procurement-chat-dot {
          animation: procurement-chat-bounce 1s infinite;
        }
      `}</style>
    </>
  );
}
