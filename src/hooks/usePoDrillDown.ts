import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * When navigating from a Purchase Order (View GRN / View Invoice),
 * `?fromPo=PO-XXXX` enables read-only drill-down mode.
 */
export function usePoDrillDown() {
  const [searchParams] = useSearchParams();
  const fromPo = searchParams.get("fromPo")?.trim() || null;

  return useMemo(() => {
    const isReadOnly = !!fromPo;
    const backToPoPath = fromPo
      ? `/p2p/purchase-orders/${encodeURIComponent(fromPo)}`
      : null;

    return { isReadOnly, fromPo, backToPoPath };
  }, [fromPo]);
}
