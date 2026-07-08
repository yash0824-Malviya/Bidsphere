import { useEffect, useRef } from "react";

import { evaluateSlaTimers } from "../../api/sla";
import { isSlaVisibleForRole } from "../../config/slaAccess";
import { useAuthStore } from "../../store/authStore";

/**
 * Background SLA runner. Mounted once in the app shell. While a user is signed
 * in, it periodically evaluates open SLA timers against backend timestamps —
 * sending reminders, marking breaches, escalating and writing audit entries.
 *
 * This is intentionally a light client-side driver on top of persisted state:
 * because due times live in ERPNext, timers keep counting correctly across
 * refreshes and restarts, and any signed-in session advances the queue. Renders
 * nothing.
 */
const EVAL_INTERVAL_MS = 60_000;

export default function SlaEngine() {
  const user = useAuthStore((s) => s.user);
  const running = useRef(false);

  useEffect(() => {
    // SLA is temporarily Admin-only — only admin sessions advance the SLA queue
    // (reminders / breaches / escalations). Backend logic is untouched.
    if (!user || !isSlaVisibleForRole(user.role)) return;
    let cancelled = false;

    const runOnce = async () => {
      if (running.current || cancelled) return;
      running.current = true;
      try {
        await evaluateSlaTimers();
      } finally {
        running.current = false;
      }
    };

    // Kick off shortly after mount, then on an interval.
    const kickoff = window.setTimeout(runOnce, 4_000);
    const id = window.setInterval(runOnce, EVAL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      window.clearInterval(id);
    };
  }, [user, user?.role]);

  return null;
}
