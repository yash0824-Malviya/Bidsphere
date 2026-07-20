import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
} from "lucide-react";

import {
  legacyPinListDiscussion,
  legacyPinMarkDiscussionRead,
  legacyPinResolveUpload,
  legacyPinSendDiscussion,
  listOnboardingDiscussion,
  markOnboardingDiscussionRead,
  resolveOnboardingDiscussion,
  resolveOnboardingUpload,
  sendOnboardingDiscussion,
  type DiscussionMessage,
  type DiscussionViewer,
} from "../../api/supplierOnboarding";
import { getFullFileUrl, uploadFileToERPNext } from "../../api/legalDocsStorage";
import { ONB } from "./enterprise/onboardingUi";

const SECTION_TAGS = [
  "Company",
  "Contact",
  "Business",
  "Plant & Capacity",
  "Bank",
  "Documents",
  "Review",
] as const;

function formatTime(raw?: string): string {
  if (!raw) return "";
  const normalized = /Z$/i.test(raw)
    ? raw
    : raw.includes("T")
      ? `${raw}Z`
      : `${raw.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  viewer: DiscussionViewer;
  /** Procurement onboarding docname */
  name?: string;
  /** Supplier portal session token */
  sessionToken?: string;
  /**
   * TEMPORARY LEGACY MODE — ERP Supplier name for Company PIN users.
   * Remove after Account Login migration.
   */
  legacySupplierName?: string;
  actorName: string;
  pollMs?: number;
  onUnreadChange?: (count: number) => void;
};

export default function OnboardingDiscussionPanel({
  viewer,
  name,
  sessionToken,
  legacySupplierName,
  actorName,
  pollMs = 15000,
  onUnreadChange,
}: Props) {
  const legacyMode = !!legacySupplierName && !sessionToken && !name;
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [sectionTag, setSectionTag] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastNotifyRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const applyPayload = useCallback(
    (payload: {
      messages: DiscussionMessage[];
      unread_count: number;
      notify?: boolean;
    }, opts?: { announce?: boolean }) => {
      const incoming = payload.messages || [];
      if (opts?.announce) {
        const freshFromOther = incoming.filter(
          (m) =>
            !knownIdsRef.current.has(m.message_id) &&
            m.sender_role !== (viewer === "supplier" ? "Supplier" : "Procurement"),
        );
        if (freshFromOther.length > 0 || (payload.notify && !lastNotifyRef.current)) {
          const preview = freshFromOther[freshFromOther.length - 1];
          toast(
            preview
              ? `New message from ${preview.sender_role}: ${preview.message.slice(0, 80)}`
              : "New onboarding discussion message",
          );
        }
      }
      knownIdsRef.current = new Set(incoming.map((m) => m.message_id));
      lastNotifyRef.current = !!payload.notify;
      setMessages(incoming);
      setUnread(payload.unread_count || 0);
      onUnreadChange?.(payload.unread_count || 0);
      requestAnimationFrame(scrollToBottom);
    },
    [viewer, onUnreadChange, scrollToBottom],
  );

  const load = useCallback(
    async (opts?: { announce?: boolean; silent?: boolean }) => {
      if (viewer === "procurement" && !name) return;
      if (viewer === "supplier" && !sessionToken && !legacySupplierName) return;
      if (!opts?.silent) setLoading(true);
      try {
        // TEMPORARY LEGACY MODE
        const res = legacyMode
          ? await legacyPinListDiscussion({
              supplier_name: String(legacySupplierName),
              viewer,
            })
          : await listOnboardingDiscussion({
              viewer,
              name,
              session_token: sessionToken,
            });
        applyPayload(res, { announce: opts?.announce });
        if ((res.unread_count || 0) > 0) {
          const marked = legacyMode
            ? await legacyPinMarkDiscussionRead({
                supplier_name: String(legacySupplierName),
                viewer,
              })
            : await markOnboardingDiscussionRead({
                viewer,
                name,
                session_token: sessionToken,
              });
          applyPayload(marked);
        }
      } catch (err) {
        if (!opts?.silent) {
          toast.error(err instanceof Error ? err.message : "Could not load discussion");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [viewer, name, sessionToken, legacySupplierName, legacyMode, applyPayload],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pollMs) return;
    const id = window.setInterval(() => {
      void load({ announce: true, silent: true });
    }, pollMs);
    return () => window.clearInterval(id);
  }, [load, pollMs]);

  async function onSend() {
    const body = text.trim();
    if (!body && !file) return;
    setSending(true);
    try {
      let file_url = "";
      let file_name = "";
      if (file) {
        const resolved = legacyMode
          ? await legacyPinResolveUpload(String(legacySupplierName))
          : viewer === "supplier"
            ? await resolveOnboardingUpload({ session_token: sessionToken })
            : { doctype: "Supplier Onboarding", docname: String(name) };
        file_url = await uploadFileToERPNext(file, resolved.doctype, resolved.docname);
        file_name = file.name;
      }
      const res = legacyMode
        ? await legacyPinSendDiscussion({
            supplier_name: String(legacySupplierName),
            viewer,
            text: body,
            actor: actorName,
            section_tag: viewer === "procurement" ? sectionTag : "",
            file_url: file_url || undefined,
            file_name: file_name || undefined,
          })
        : await sendOnboardingDiscussion({
            viewer,
            name,
            session_token: sessionToken,
            text: body,
            actor: actorName,
            section_tag: viewer === "procurement" ? sectionTag : "",
            file_url: file_url || undefined,
            file_name: file_name || undefined,
          });
      applyPayload(res);
      setText("");
      setFile(null);
      setSectionTag("");
      toast.success("Message sent");
      await load({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  async function onResolve(messageId: string, resolved: boolean) {
    if (viewer !== "procurement" || !name) return;
    try {
      const res = await resolveOnboardingDiscussion({
        name,
        message_id: messageId,
        actor: actorName,
        resolved,
      });
      applyPayload(res);
      toast.success(resolved ? "Marked as resolved" : "Reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update message");
    }
  }

  return (
    <div className="flex max-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: ONB.primary }}
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Discussion</h3>
            <p className="text-[11px] text-slate-500">Procurement ↔ Supplier</p>
          </div>
          {unread > 0 ? (
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              {unread} unread
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              Up to date
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          aria-label="Refresh discussion"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No messages yet. Start the discussion.
          </div>
        ) : (
          messages.map((m) => {
            const mine =
              m.sender_role === (viewer === "supplier" ? "Supplier" : "Procurement");
            const isProcurement = m.sender_role === "Procurement";
            return (
              <div
                key={m.message_id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                    mine
                      ? "rounded-br-md text-white"
                      : isProcurement
                        ? "rounded-bl-md border border-blue-100 bg-white text-slate-800"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                  } ${m.resolved ? "opacity-80" : ""}`}
                  style={mine ? { backgroundColor: ONB.primary } : undefined}
                >
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                      mine ? "text-blue-100" : "text-slate-500"
                    }`}
                  >
                    <span className={`font-semibold ${mine ? "text-white" : "text-slate-800"}`}>
                      {m.sender_name}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                          mine ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {m.sender_role}
                      </span>
                      {m.resolved ? (
                        <span
                          className={`ml-1.5 inline-flex items-center gap-0.5 ${
                            mine ? "text-emerald-200" : "text-emerald-700"
                          }`}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Resolved
                        </span>
                      ) : null}
                    </span>
                    <span>{formatTime(m.sent_on)}</span>
                  </div>
                  {m.section_tag ? (
                    <p
                      className={`mt-1 text-xs font-semibold ${
                        mine ? "text-amber-100" : "text-amber-800"
                      }`}
                    >
                      [{m.section_tag}]
                    </p>
                  ) : null}
                  {m.message ? (
                    <p
                      className={`mt-1.5 whitespace-pre-wrap leading-relaxed ${
                        mine ? "text-white" : "text-slate-800"
                      }`}
                    >
                      {m.message}
                    </p>
                  ) : null}
                  {m.file_url ? (
                    <a
                      href={getFullFileUrl(m.file_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline ${
                        mine ? "text-blue-50" : "text-blue-700"
                      }`}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {m.file_name || "Attachment"}
                    </a>
                  ) : null}
                  {viewer === "procurement" ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => void onResolve(m.message_id, !m.resolved)}
                        className={`text-xs font-medium underline-offset-2 hover:underline ${
                          mine ? "text-blue-100" : "text-slate-600"
                        }`}
                      >
                        {m.resolved ? "Reopen" : "Mark as Resolved"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="sticky bottom-0 space-y-2 border-t border-slate-100 bg-white px-4 py-3">
        {viewer === "procurement" ? (
          <label className="block text-xs font-semibold text-slate-600">
            Tag section (optional)
            <select
              value={sectionTag}
              onChange={(e) => setSectionTag(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">No section tag</option>
              {SECTION_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={
              viewer === "procurement"
                ? "Message the supplier…"
                : "Reply to procurement…"
            }
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50">
              <Paperclip className="h-4 w-4" />
              <span className="sr-only">Attach file</span>
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              disabled={sending || (!text.trim() && !file)}
              onClick={() => void onSend()}
              className="inline-flex items-center justify-center rounded-xl p-2.5 text-white disabled:opacity-60"
              style={{ backgroundColor: ONB.primary }}
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        {file ? (
          <p className="truncate text-xs text-slate-500">Attached: {file.name}</p>
        ) : null}
      </div>
    </div>
  );
}
