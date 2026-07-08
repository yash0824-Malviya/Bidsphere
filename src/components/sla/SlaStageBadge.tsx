import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  completeSlaTimer,
  ensureSlaTimer,
  listTimersForReference,
  type SlaTimer,
} from "../../api/sla";
import type { SlaWorkflow } from "../../config/slaWorkflows";
import { useSlaVisible } from "../../hooks/useSlaVisible";
import SlaBadge from "./SlaBadge";

interface Props {
  workflow: SlaWorkflow;
  stage?: string;
  referenceDoctype: string;
  referenceName: string;
  /**
   * Whether this stage is currently OPEN (awaiting action). When true the timer
   * is ensured; when false it is completed. Undefined leaves it untouched.
   */
  open?: boolean;
  priority?: string;
  className?: string;
}

/**
 * Drop-in SLA badge for a workflow stage. It keeps the "SLA Log" for
 * (document, stage) in sync — starting it while the stage is open and
 * completing it once it closes — then renders the live countdown. All timing
 * comes from the SLA Configuration for the workflow; if none is active nothing
 * is created and the badge simply renders nothing.
 */
export default function SlaStageBadge({
  workflow,
  stage,
  referenceDoctype,
  referenceName,
  open,
  priority,
  className,
}: Props) {
  // SLA is temporarily Admin-only — non-admin users neither read nor mutate SLA
  // logs from stage badges, and the badge renders nothing for them.
  const slaVisible = useSlaVisible();
  const { data, refetch } = useQuery<SlaTimer[]>({
    queryKey: ["sla-stage", referenceDoctype, referenceName],
    queryFn: () => listTimersForReference(referenceDoctype, referenceName),
    enabled: slaVisible && !!referenceName,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!slaVisible || !referenceName || open === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        if (open) {
          await ensureSlaTimer({
            workflow,
            stage,
            referenceDoctype,
            referenceName,
            priority,
          });
        } else {
          await completeSlaTimer(referenceDoctype, referenceName, { workflow });
        }
        if (!cancelled) void refetch();
      } catch {
        /* best-effort — never block the page */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slaVisible, workflow, stage, referenceDoctype, referenceName, open, priority]);

  if (!slaVisible) return null;

  const timer = (data ?? []).find(
    (t) => String(t.workflow) === String(workflow)
  );
  if (!timer) return null;
  return <SlaBadge timer={timer} className={className} />;
}
