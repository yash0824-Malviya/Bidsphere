import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Loader2, ShieldCheck } from "lucide-react";

import {
  appendWarehouseEsignAudit,
  buildWarehouseEsignErpFields,
  finalizeWarehouseSignatureForReview,
  hasReviewSignatureReady,
  persistWarehouseGrnDigitalSignature,
} from "../../../api/warehouseEsign";
import type { PurchaseReceipt } from "../../../types/erpnext";
import {
  createInitialWarehouseEsignState,
  type WarehouseEsignState,
} from "../../../types/warehouseEsign";
import { useAuthStore } from "../../../store/authStore";
import WarehouseReviewSignPanel from "./WarehouseReviewSignPanel";

interface Props {
  grn: PurchaseReceipt;
}

/**
 * Breaks the Finance / Warehouse deadlock for GRNs that were submitted without
 * permanent e-sign storage. Warehouse completes signature here; PDF is stored
 * once (never regenerated later).
 */
export default function CompleteWarehouseSignatureCard({ grn }: Props) {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const [esign, setEsign] = useState<WarehouseEsignState>(() =>
    createInitialWarehouseEsignState({
      fullName: authUser?.full_name || "Warehouse Manager",
      designation: "Warehouse Manager",
      role: "Warehouse Manager",
      email: authUser?.email || "",
    }),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!hasReviewSignatureReady(esign)) {
        throw new Error(
          "Capture your signature and certify received goods before finalizing.",
        );
      }
      let signed = esign;
      if (!esign.signatureHash || !esign.placed) {
        signed = await finalizeWarehouseSignatureForReview({
          ...esign,
          certified: true,
        });
        setEsign(signed);
      }

      const source: PurchaseReceipt = {
        ...grn,
        ...buildWarehouseEsignErpFields({
          ...signed,
          verificationStatus: "verified",
        }),
        items: grn.items ?? [],
      } as PurchaseReceipt;

      return persistWarehouseGrnDigitalSignature(
        source,
        { ...signed, verificationStatus: "verified" },
        grn.status || "Submitted",
      );
    },
    onSuccess: (stored) => {
      appendWarehouseEsignAudit(
        "Warehouse signed GRN",
        esign.fullName || authUser?.full_name || "Warehouse Manager",
        stored.fileUrl
          ? `${grn.name} → ${stored.fileUrl}`
          : `${grn.name} · signature metadata stored (PDF generating)`,
        { grnName: grn.name, targetRole: "warehouse" },
      );
      toast.success(
        stored.pdfStored
          ? "Digital Signature completed. Signed GRN PDF stored."
          : "Digital Signature completed. Signed PDF will generate in the background.",
      );
      void queryClient.invalidateQueries({
        queryKey: ["purchase-receipt", grn.name],
      });
      void queryClient.invalidateQueries({ queryKey: ["grns-awaiting-invoice"] });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Could not complete digital signature.",
      );
    },
  });

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-700" />
        <div>
          <h2 className="text-sm font-semibold text-amber-950">
            Complete Warehouse Digital Signature
          </h2>
          <p className="text-xs text-amber-900">
            This GRN is missing Warehouse Digital Signature metadata. Sign here to
            unlock Inventory confirmation for Finance and enable voucher creation.
            Signed PDF preview is generated in the background (optional).
          </p>
        </div>
      </div>

      <WarehouseReviewSignPanel
        value={esign}
        onChange={setEsign}
        disabled={mutation.isPending}
      />

      <button
        type="button"
        disabled={mutation.isPending || !hasReviewSignatureReady(esign)}
        onClick={() => mutation.mutate()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Storing Digital Signature…
          </>
        ) : (
          "Sign & Finalize GRN"
        )}
      </button>
    </section>
  );
}
