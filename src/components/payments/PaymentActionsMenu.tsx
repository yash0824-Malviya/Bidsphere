import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Printer,
} from "lucide-react";

import { getPaymentEntry } from "../../api/accounts";
import type { PaymentEntry } from "../../types/erpnext";
import {
  downloadPaymentReceiptPdf,
  printPaymentReceiptPdf,
} from "../../utils/pdf";

interface Props {
  payment: PaymentEntry;
}

export default function PaymentActionsMenu({ payment }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function withFullEntry(
    fn: (entry: PaymentEntry) => void | Promise<void>
  ) {
    setBusy(true);
    try {
      const entry = await getPaymentEntry(payment.name!);
      await fn(entry);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not load payment."
      );
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  const items = [
    {
      label: "View Details",
      icon: Eye,
      onClick: () => {
        setOpen(false);
        navigate(`/p2p/payments/${encodeURIComponent(payment.name!)}`);
      },
    },
    {
      label: "Download Receipt",
      icon: Download,
      onClick: () =>
        void withFullEntry((e) => downloadPaymentReceiptPdf(e)),
    },
    {
      label: "Download PDF",
      icon: FileText,
      onClick: () =>
        void withFullEntry((e) => downloadPaymentReceiptPdf(e)),
    },
    {
      label: "Print Payment",
      icon: Printer,
      onClick: () => void withFullEntry((e) => printPaymentReceiptPdf(e)),
    },
  ];

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-600"
        aria-label="Payment actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg ring-1 ring-black/5">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={busy}
              onClick={item.onClick}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
            >
              <item.icon className="h-4 w-4 shrink-0 text-neutral-400" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
