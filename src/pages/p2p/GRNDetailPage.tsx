import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  BadgeCheck,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Lock,
  Package,
  PackagePlus,
  Printer,
  Send,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { createVoucher, getAllVouchers } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { Voucher, VoucherItem } from "../../types/voucher";
import {
  getGRNsForPO,
  getPurchaseOrder,
  getPurchaseReceipt,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import { reconcileProcurementReadyToIssue } from "../../api/materialRequestWorkflow";
import { advancePoWorkflowAfterGrnSubmit } from "../../api/poDeliveryWorkflow";
import { getInvoicesForPO } from "../../api/accounts";
import { invalidateWarehouseStock } from "../../api/warehouseStock";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import {
  appendWarehouseEsignAudit,
  assertGrnReadyForVoucherAsync,
  ensureWarehouseSignatureIntegrity,
  fetchStoredSignedGrnPdfBytes,
  getWarehouseSignatureSummary,
  hasWarehouseSignedPdfStored,
  isWarehouseDigitalSignatureComplete,
  resolveSignedGrnPdfUrl,
  verifyWarehouseGrnSignature,
  type WarehouseSignatureVerification,
} from "../../api/warehouseEsign";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import ReadOnlyViewBadge from "../../components/document/ReadOnlyViewBadge";
import EmptyState from "../../components/EmptyState";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
import ProcurementTimeline from "../../components/supplier-portal/ProcurementTimeline";
import LineEngineeringDocsCell from "../../components/attachments/LineEngineeringDocsCell";
import CompleteWarehouseSignatureCard from "../../components/warehouse/esign/CompleteWarehouseSignatureCard";
import SignaturePreviewCard from "../../components/warehouse/SignaturePreviewCard";
import SignedGrnPdfViewer from "../../components/warehouse/SignedGrnPdfViewer";
import WarehouseSignatureVerifyModal from "../../components/warehouse/WarehouseSignatureVerifyModal";
import WarehouseVerificationCard from "../../components/warehouse/WarehouseVerificationCard";
import { usePoDrillDown } from "../../hooks/usePoDrillDown";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import {
  canCreateGRN,
  canDigitallySignGRN,
  canManageVouchers,
} from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import { grnPdfFilename } from "../../utils/pdf";
import {
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
  purchaseOrderDetailPath,
} from "../../utils/supplierPortalUtils";

const LARGE_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  Submitted: "bg-primary-50 text-primary-800 ring-primary-200",
  "To Bill": "bg-primary-50 text-primary-800 ring-primary-200",
  Completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Closed: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  Cancelled: "bg-red-50 text-red-700 ring-red-200",
  "Return Issued": "bg-amber-50 text-amber-800 ring-amber-200",
};

export default function GRNDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isReadOnly, backToPoPath } = usePoDrillDown();
  const authUser = useAuthStore((s) => s.user);
  const role = authUser?.role;
  const canCreateVoucher = canManageVouchers(role);
  const canManageGRN = canCreateGRN(role);
  const canSignGRN = canDigitallySignGRN(role);
  // Warehouse may create/sign; Finance/Procurement view read-only.
  const isGrnReadOnly = isReadOnly || !(canManageGRN || canSignGRN);
  const name = decodeURIComponent(id);
  /** Dev/Demo builds only — never true for production Vite builds. */
  const isDevDemoMode = Boolean(import.meta.env.DEV);
  const voucherBlockedReason =
    "Warehouse Digital Signature is required before voucher creation.";

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const {
    data: grn,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["purchase-receipt", name],
    queryFn: () => getPurchaseReceipt(name),
    enabled: !!name,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const linkedPOForQuery = grn
    ? (grn.items ?? []).find((it) => it.purchase_order)?.purchase_order
    : undefined;

  const syncVersion = useVoucherSyncStore((s) => s.version);
  const { data: allVouchers = [] } = useQuery({
    queryKey: ["vouchers-all", syncVersion],
    queryFn: () => getAllVouchers(),
    staleTime: 30_000,
  });
  const voucher = useMemo(
    () => allVouchers.find((v) => v.grn_reference === name) ?? null,
    [allVouchers, name]
  );
  const hasVoucher = !!voucher;

  const [creatingVoucher, setCreatingVoucher] = useState(false);
  const [demoOverrideOpen, setDemoOverrideOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] =
    useState<WarehouseSignatureVerification | null>(null);
  /** Finance must verify (or auto-integrity must pass) before voucher creation. */
  const [signatureVerified, setSignatureVerified] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [viewedAuditLogged, setViewedAuditLogged] = useState(false);
  const [fullscreenToken, setFullscreenToken] = useState(0);

  const signatureComplete = isWarehouseDigitalSignatureComplete(grn);
  const pdfStored = hasWarehouseSignedPdfStored(grn);
  const signatureSummary = useMemo(
    () => (grn ? getWarehouseSignatureSummary(grn) : null),
    [grn],
  );
  /** View/Download when live rebuild or stored PDF bytes are ready. */
  const signedPdfReady = Boolean(pdfBytes && !pdfError && !pdfLoading);
  /** Voucher gate = Digital Signature only (PDF is optional preview). */
  const voucherReady = Boolean(signatureComplete && signatureVerified);

  // Soft-check document fingerprint; invalidate signature if GRN data drifted.
  useEffect(() => {
    if (!grn?.name) return;
    let cancelled = false;
    void ensureWarehouseSignatureIntegrity(grn).then((result) => {
      if (cancelled || (!result.invalidated && !result.migrated)) return;
      void queryClient.invalidateQueries({ queryKey: ["purchase-receipt", name] });
      if (result.invalidated) {
        setSignatureVerified(false);
        setVerifyResult(null);
        toast.error(
          "GRN data changed after signing. Warehouse Digital Signature was invalidated — please re-sign.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grn?.name, grn?.modified, queryClient, name]);

  // Load Signed PDF: Finance/Procurement prefer permanently stored file;
  // Warehouse may live-rebuild so the signature block is always visible.
  useEffect(() => {
    if (!grn) {
      setPdfBytes(null);
      setPdfError(null);
      return;
    }
    if (!signatureComplete && !hasWarehouseSignedPdfStored(grn)) {
      setPdfBytes(null);
      setPdfError(null);
      setPdfLoading(false);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    const preferStoredPdf =
      role === "finance" ||
      role === "procurement_team" ||
      role === "admin" ||
      isGrnReadOnly;
    void (async () => {
      try {
        let bytes: ArrayBuffer | null = null;
        if (preferStoredPdf && hasWarehouseSignedPdfStored(grn)) {
          bytes = await fetchStoredSignedGrnPdfBytes(grn);
        }
        if (!bytes && signatureComplete) {
          try {
            const { buildSignedGrnPdfBytes } = await import("../../utils/pdf/grnPdf");
            const statusLabel =
              grn.status ?? ((grn.docstatus ?? 0) === 0 ? "Draft" : "Submitted");
            bytes = await buildSignedGrnPdfBytes(grn, statusLabel);
          } catch (regenErr) {
            // eslint-disable-next-line no-console
            console.warn("[GRN] Live signed PDF rebuild failed:", regenErr);
          }
        }
        if (!bytes && hasWarehouseSignedPdfStored(grn)) {
          bytes = await fetchStoredSignedGrnPdfBytes(grn);
        }
        if (cancelled) return;
        if (!bytes) {
          setPdfBytes(null);
          setPdfError(
            signatureComplete
              ? "Signed PDF preview is not available yet. Signature metadata is verified."
              : null,
          );
          return;
        }
        setPdfBytes(bytes);
        setPdfError(null);
        if ((role === "finance" || role === "admin") && !viewedAuditLogged) {
          const fileUrl = await resolveSignedGrnPdfUrl(grn);
          appendWarehouseEsignAudit(
            "Finance viewed signed GRN",
            authUser?.full_name || authUser?.email || "Finance",
            `${name}${fileUrl ? ` · ${fileUrl}` : ""}`,
            { targetRole: "finance", grnName: name },
          );
          setViewedAuditLogged(true);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setPdfError(
            err instanceof Error
              ? err.message
              : "Signed PDF is not yet generated. Digital Signature has been verified.",
          );
          setPdfBytes(null);
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // viewedAuditLogged intentionally omitted — set inside effect once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grn, name, role, authUser, signatureComplete, isGrnReadOnly]);

  // Auto-verify from signature metadata (not PDF presence).
  useEffect(() => {
    if (!grn || !signatureComplete) {
      setSignatureVerified(false);
      setVerifyResult(null);
      return;
    }
    let cancelled = false;
    void verifyWarehouseGrnSignature(grn).then((result) => {
      if (cancelled) return;
      setVerifyResult(result);
      if (
        result.signed &&
        result.integrity !== "modified" &&
        (result.valid || Boolean(result.hash) || signatureComplete)
      ) {
        setSignatureVerified(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [grn, signatureComplete]);

  async function handleVerifySignature() {
    if (!grn) return;
    setVerifyOpen(true);
    setVerifyBusy(true);
    try {
      const result = await verifyWarehouseGrnSignature(grn);
      setVerifyResult(result);
      if (
        result.signed &&
        result.integrity !== "modified" &&
        (result.valid || Boolean(result.hash))
      ) {
        setSignatureVerified(true);
        appendWarehouseEsignAudit(
          "Finance verified warehouse signature",
          authUser?.full_name || authUser?.email || role || "User",
          name,
          {
            targetRole:
              role === "finance" || role === "admin"
                ? "finance"
                : role === "procurement" || role === "procurement_team"
                  ? "procurement"
                  : "warehouse",
            grnName: name,
          },
        );
        toast.success("Warehouse signature verified.");
      } else if (!result.signed) {
        setSignatureVerified(false);
        toast.error("Warehouse GRN is not digitally signed.");
      } else {
        setSignatureVerified(false);
        toast.error("Signature verification failed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyBusy(false);
    }
  }

  function scrollToSignedGrn() {
    document.getElementById("grn-signed-document")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function openSignedGrnFullscreen() {
    scrollToSignedGrn();
    setFullscreenToken((n) => n + 1);
  }

  function requestCreateVoucher() {
    // eslint-disable-next-line no-console
    console.log("Create Voucher clicked");
    if (!grn) {
      // eslint-disable-next-line no-console
      console.warn("[Create Voucher] stopped: GRN not loaded");
      return;
    }
    if (!canCreateVoucher) {
      toast.error("Only Finance can create vouchers.");
      return;
    }
    if (hasVoucher) {
      navigate(`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`);
      return;
    }
    // Production: hard-block until signature is complete.
    if (!isDevDemoMode && !voucherReady) {
      toast.error(voucherBlockedReason);
      return;
    }
    // Dev/Demo: confirm before bypassing a pending Warehouse Digital Signature.
    if (isDevDemoMode && !voucherReady) {
      setDemoOverrideOpen(true);
      return;
    }
    void handleCreateVoucher({ demoOverride: false });
  }

  async function handleCreateVoucher(opts?: { demoOverride?: boolean }) {
    if (!grn) return;

    if (!canCreateVoucher) {
      toast.error("Only Finance can create vouchers.");
      return;
    }

    if (hasVoucher) {
      navigate(`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`);
      return;
    }

    const demoOverride = Boolean(opts?.demoOverride) && isDevDemoMode;

    if (!demoOverride) {
      if (!signatureComplete || !signatureVerified) {
        // eslint-disable-next-line no-console
        console.warn("[Create Voucher] stopped: signature gate", {
          signatureComplete,
          signatureVerified,
        });
        toast.error(voucherBlockedReason);
        return;
      }

      const gate = await assertGrnReadyForVoucherAsync(grn);
      if (!gate.ok) {
        // eslint-disable-next-line no-console
        console.warn("[Create Voucher] stopped: assertGrnReadyForVoucherAsync", gate);
        toast.error(gate.message || "GRN is not ready for voucher creation.");
        return;
      }
    }

    // eslint-disable-next-line no-console
    console.log("Validation passed");
    setDemoOverrideOpen(false);
    setCreatingVoucher(true);
    try {
      const items: VoucherItem[] = (grn.items ?? []).map((it) => ({
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        qty: it.qty,
        rate: it.rate,
        amount: it.amount ?? it.rate * it.qty,
        uom: it.uom ?? "Nos",
      }));
      // eslint-disable-next-line no-console
      console.log("Calling voucher API", {
        grn_reference: name,
        po_reference: linkedPOForQuery ?? "",
        supplier: grn.supplier,
      });
      const created = await createVoucher({
        po_reference: linkedPOForQuery ?? "",
        grn_reference: name,
        supplier: grn.supplier,
        supplier_name: grn.supplier_name ?? grn.supplier,
        amount: grn.grand_total ?? items.reduce((s, it) => s + it.amount, 0),
        currency: grn.currency ?? "USD",
        items,
        notes: demoOverride
          ? "Created without mandatory Warehouse Digital Signature (Demo Override)."
          : undefined,
      });
      // eslint-disable-next-line no-console
      console.log("Voucher API response", created);
      if (demoOverride) {
        appendWarehouseEsignAudit(
          "Voucher created using Demo Override",
          authUser?.full_name || authUser?.email || "Finance",
          `${name} → ${created.id}`,
          { targetRole: "finance", grnName: name },
        );
        toast.success(
          `Voucher ${created.id} created (Demo Override — signature pending).`,
        );
      } else {
        appendWarehouseEsignAudit(
          "Voucher created",
          authUser?.full_name || authUser?.email || "Finance",
          `${name} → ${created.id}`,
          { targetRole: "finance", grnName: name },
        );
        toast.success(`Voucher ${created.id} created!`);
      }
      void queryClient.invalidateQueries({
        queryKey: ["grns-awaiting-invoice"],
      });
      navigate(`/p2p/vouchers/${encodeURIComponent(created.id)}`);
    } catch (err) {
      // Regression: errors were previously swallowed (try/finally with no catch),
      // so the button appeared to do nothing when createVoucher failed.
      // eslint-disable-next-line no-console
      console.error("[Create Voucher] API failed:", err);
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Could not create the voucher.";
      toast.error(message);
    } finally {
      setCreatingVoucher(false);
    }
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!isWarehouseDigitalSignatureComplete(grn)) {
        throw new Error(
          "Warehouse Digital Signature is mandatory before submitting GRN. Complete Warehouse E-Sign first.",
        );
      }
      const submitted = await submitPurchaseReceipt(name);
      // Goods are now on-hand in ERPNext Bin — advance any procurement MR whose
      // forwarded quantity is fully received to "Ready to Issue". Best-effort.
      try {
        await reconcileProcurementReadyToIssue();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[GRN submit] Ready-to-Issue reconciliation skipped:", err);
      }
      return submitted;
    },
    onSuccess: async () => {
      toast.success(`${name} submitted — goods received recorded.`);
      invalidateWarehouseStock(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["grns-awaiting-invoice"] });
      invalidateFinanceDashboardMetrics(queryClient);
      const linkedPO =
        primaryPOFromReceipt(grn!) ??
        (grn!.items ?? []).find((it) => it.purchase_order)?.purchase_order;
      if (linkedPO) {
        try {
          const [freshPo, freshGrns, freshInvoices] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: ["purchase-order", linkedPO],
              queryFn: () => getPurchaseOrder(linkedPO),
            }),
            queryClient.fetchQuery({
              queryKey: ["po-grns", linkedPO],
              queryFn: () => getGRNsForPO(linkedPO),
            }),
            queryClient.fetchQuery({
              queryKey: ["po-invoices", linkedPO],
              queryFn: () => getInvoicesForPO(linkedPO),
            }),
          ]);
          const submittedGrnCount = freshGrns.filter((g) => g.docstatus === 1).length;
          const primaryInvoice =
            freshInvoices.find((inv) => inv.docstatus === 1) ?? freshInvoices[0];
          await advancePoWorkflowAfterGrnSubmit(linkedPO, {
            perReceived: freshPo.per_received ?? 0,
            perBilled: freshPo.per_billed ?? 0,
            submittedGrnCount,
            hasSubmittedInvoice: freshInvoices.some((inv) => inv.docstatus === 1),
            invoiceOutstanding: primaryInvoice?.outstanding_amount,
            invoiceGrandTotal: primaryInvoice?.grand_total,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[GRN submit] PO workflow sync failed:", err);
          void queryClient.invalidateQueries({
            queryKey: ["purchase-order", linkedPO],
          });
          void queryClient.invalidateQueries({
            queryKey: ["po-grns", linkedPO],
          });
          void queryClient.invalidateQueries({
            queryKey: ["po-shipment", linkedPO],
          });
        }
      }
    },
    onError: (err) => {
      toast.error(
        `Submit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 8_000 }
      );
    },
  });

  if (isLoading) {
    return <AppLoading variant="document" />;
  }

  if (isError || !grn) {
    return (
      <EnterpriseError
        error={error ?? new Error("not found")}
        onRetry={() => void refetch()}
        onBack={() => window.history.back()}
      />
    );
  }

  const isDraft = (grn.docstatus ?? 0) === 0;
  const isSubmitted = (grn.docstatus ?? 0) === 1;
  const statusLabel = grn.status ?? (isDraft ? "Draft" : "Submitted");

  const linkedPOName = primaryPOFromReceipt(grn);
  const linkedPOPath = linkedPOName ? purchaseOrderDetailPath(linkedPOName) : undefined;

  const warehouse = primaryWarehouseFromReceipt(grn);

  const handlePrint = () => {
    void (async () => {
      try {
        const bytes =
          pdfBytes ?? (await fetchStoredSignedGrnPdfBytes(grn));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (w) {
          w.addEventListener("load", () => {
            try {
              w.print();
            } catch {
              /* user can print from viewer */
            }
          });
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not open print preview.",
        );
      }
    })();
  };

  const handleDownload = () => {
    void (async () => {
      try {
        const bytes =
          pdfBytes ?? (await fetchStoredSignedGrnPdfBytes(grn));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          grnPdfFilename(grn).replace(/\.pdf$/i, "") + "-signed.pdf";
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        try {
          const fileUrl = await resolveSignedGrnPdfUrl(grn);
          if (fileUrl) {
            window.open(getFullFileUrl(fileUrl), "_blank", "noopener,noreferrer");
            return;
          }
        } catch {
          /* fall through */
        }
        toast.error(
          err instanceof Error ? err.message : "Could not download signed GRN.",
        );
      }
    })();
  };

  const workflow = deriveGrnWorkflow({
    linkedPOName,
    isSubmitted,
    hasVoucher,
    voucher,
    signatureComplete,
  });

  const financeStage = deriveFinanceStage({
    isSubmitted,
    isDraft,
    hasVoucher,
    voucher,
    canCreateVoucher,
    isReadOnly,
    signatureComplete,
  });

  const activityEvents = buildActivityEvents(grn, voucher, isSubmitted);

  return (
    <div className="space-y-3 pb-4">
      <BackLink backToPoPath={backToPoPath} />

      {/* Toolbar — document reference + status/actions (no page title) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-700">
            {grn.name}
            <span className="font-normal text-neutral-500">
              {" "}
              &middot; {grn.supplier_name ?? grn.supplier}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isGrnReadOnly && <ReadOnlyViewBadge />}
          <LargeStatusBadge status={statusLabel} />
          {!isGrnReadOnly && isDraft && canManageGRN && (
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={
                submitMutation.isPending || !signatureComplete
              }
              title={
                !signatureComplete
                  ? "Warehouse Digital Signature is mandatory before submitting GRN."
                  : undefined
              }
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit GRN
            </button>
          )}
        </div>
      </div>

      {/* Compact summary strip */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <SummaryField
              label="PO Reference"
              value={
                linkedPOName && linkedPOPath ? (
                  <Link
                    to={linkedPOPath}
                    className="font-semibold text-primary-600 hover:underline"
                  >
                    {linkedPOName}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <SummaryField label="Posting Date" value={formatDate(grn.posting_date)} />
            <SummaryField label="Warehouse" value={warehouse ?? "—"} />
          </div>
          <div className="space-y-2 sm:border-l sm:border-neutral-100 sm:pl-4">
            <SummaryField label="Status" value={statusLabel} />
            <SummaryField
              label="Total Value"
              value={formatCurrency(grn.grand_total)}
              highlight
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Items received table */}
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-3.5 py-2.5">
              <h2 className="text-sm font-semibold text-neutral-900">Items Received</h2>
              <p className="text-[11px] text-neutral-500">
                {(grn.items ?? []).length} line item{(grn.items ?? []).length === 1 ? "" : "s"}
              </p>
            </div>

            {(grn.items ?? []).length === 0 ? (
              <EmptyState
                icon={PackagePlus}
                title="No items"
                description="This GRN has no line items."
              />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-neutral-50 shadow-[0_1px_0_0_rgb(229,229,229)]">
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      <th className="px-3.5 py-2.5">Item</th>
                      <th className="px-3 py-2.5 min-w-[160px]">Attachments</th>
                      <th className="px-3 py-2.5">Purchase Order</th>
                      <th className="px-3 py-2.5 text-right">Qty</th>
                      <th className="px-3 py-2.5">UOM</th>
                      <th className="px-3 py-2.5 text-right">Rate</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {(grn.items ?? []).map((item, idx) => (
                      <tr
                        key={item.name ?? idx}
                        className="transition-colors hover:bg-primary-50/30"
                      >
                        <td className="px-3.5 py-2.5 align-top">
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
                              <Package className="h-4 w-4 text-primary-600" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-neutral-900">{item.item_code}</p>
                              {item.item_name && item.item_name !== item.item_code && (
                                <p className="text-xs text-neutral-500">{item.item_name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <LineEngineeringDocsCell
                            lookup={{
                              item_code: item.item_code,
                              purchase_order: item.purchase_order,
                              purchase_order_item: item.purchase_order_item,
                            }}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600 align-top">
                          {item.purchase_order ? (
                            <Link
                              to={purchaseOrderDetailPath(item.purchase_order)}
                              className="text-primary-600 hover:underline"
                            >
                              {item.purchase_order}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800 align-top">
                          {item.qty ?? 0}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600 align-top">{item.uom ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 align-top">
                          {formatCurrency(item.rate)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-neutral-900 align-top">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-primary-600 text-white">
                    <tr>
                      <td colSpan={6} className="px-3.5 py-3 text-right text-sm font-semibold">
                        Grand Total
                      </td>
                      <td className="px-3.5 py-3 text-right text-base font-bold tabular-nums">
                        {formatCurrency(grn.grand_total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {!signatureComplete && canManageGRN && !isGrnReadOnly && (
            <CompleteWarehouseSignatureCard grn={grn} />
          )}

          {/* Signed GRN document — Finance / Warehouse viewing */}
          <section
            id="grn-signed-document"
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-3.5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">GRN Document</h2>
                <p className="text-[11px] text-neutral-500">
                  Warehouse signed Goods Receipt Note
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <DocActionBtn
                  icon={Eye}
                  label="View Full Screen"
                  onClick={openSignedGrnFullscreen}
                  disabled={!signedPdfReady}
                />
                <DocActionBtn
                  icon={Download}
                  label="Download Signed GRN"
                  onClick={handleDownload}
                  disabled={!signedPdfReady}
                />
                <DocActionBtn
                  icon={Printer}
                  label="Print GRN"
                  onClick={handlePrint}
                  disabled={!signedPdfReady}
                />
              </div>
            </div>

            <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-2">
                {signedPdfReady && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                    Viewing the stored Signed GRN PDF
                  </div>
                )}
                {!signatureComplete && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Warehouse Digital Signature is required before voucher creation. Complete
                    Warehouse E-Sign to continue.
                  </div>
                )}
                <SignedGrnPdfViewer
                  pdfBytes={signedPdfReady ? pdfBytes : null}
                  loading={pdfLoading}
                  fullscreenToken={fullscreenToken}
                  error={
                    // Only surface hard load failures when a PDF URL exists.
                    pdfStored && pdfError ? pdfError : null
                  }
                  emptyHint={
                    signedPdfReady
                      ? null
                      : signatureComplete
                        ? "Building Signed GRN PDF with embedded signature…"
                        : "Signed PDF preview will appear after Warehouse Digital Signature is completed."
                  }
                  onDownload={signedPdfReady ? handleDownload : undefined}
                  onPrint={signedPdfReady ? handlePrint : undefined}
                  className="min-h-[420px]"
                />
              </div>

              <aside className="space-y-3">
                {signatureComplete && signatureSummary ? (
                  <>
                    <SignaturePreviewCard
                      grn={grn}
                      summary={signatureSummary}
                      certificateStatus={
                        verifyResult?.certificateStatus ||
                        signatureSummary.certificateStatus ||
                        "Valid"
                      }
                      integrityLabel={
                        verifyResult?.integrity === "intact" ||
                        signatureVerified ||
                        String(signatureSummary.documentIntegrity || "")
                          .toLowerCase() === "verified"
                          ? "Verified"
                          : signatureSummary.documentIntegrity || "Pending"
                      }
                    />
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                      <div className="mb-2 flex items-start gap-2">
                        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                            Digital Signature Information
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-emerald-900">
                            ✔ Warehouse Digital Signature Verified
                          </p>
                        </div>
                      </div>
                      <dl className="space-y-2 text-sm">
                        <SigRow
                          label="Signed By"
                          value={signatureSummary.signedBy || "Warehouse Manager"}
                        />
                        <SigRow
                          label="Role"
                          value={signatureSummary.role || "Warehouse Manager"}
                        />
                        <SigRow
                          label="Signed On"
                          value={`${signatureSummary.signedDateLabel} · ${signatureSummary.signedTimeLabel}`}
                        />
                        <SigRow
                          label="SHA-256 Hash"
                          value={
                            signatureSummary.sha256Hash ||
                            signatureSummary.hashMasked
                          }
                          mono
                        />
                        <SigRow
                          label="Certificate Status"
                          value={
                            verifyResult?.certificateStatus ||
                            signatureSummary.certificateStatus ||
                            "Valid"
                          }
                          tone="ok"
                        />
                        <SigRow
                          label="Integrity"
                          value={
                            verifyResult?.integrity === "intact" ||
                            signatureVerified ||
                            String(signatureSummary.documentIntegrity || "")
                              .toLowerCase() === "verified"
                              ? "Verified"
                              : signatureSummary.documentIntegrity || "Pending"
                          }
                          tone="ok"
                        />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-emerald-100 pt-3">
                        <DocActionBtn
                          icon={ShieldCheck}
                          label="Verify Signature"
                          onClick={() => void handleVerifySignature()}
                          primary
                        />
                        <DocActionBtn
                          icon={Eye}
                          label="View Signed GRN"
                          onClick={openSignedGrnFullscreen}
                          disabled={!signedPdfReady}
                        />
                        <DocActionBtn
                          icon={Download}
                          label="Download Signed PDF"
                          onClick={handleDownload}
                          disabled={!signedPdfReady}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                    <div className="mb-2 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-amber-700" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
                        Warehouse Digital Signature
                      </h3>
                    </div>
                    <p className="text-xs text-amber-900">
                      Mandatory before Inventory Update and Voucher Pending. Finance cannot
                      continue until Warehouse completes Digital Signature.
                    </p>
                    {canManageGRN && (
                      <Link
                        to="/warehouse/inventory/create-grn"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-800"
                      >
                        Complete & Sign in Receive Goods
                      </Link>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </section>

          {/* Procurement workflow — replaces GRN submitted banner */}
          <ProcurementTimeline steps={workflow.steps} title="Procurement Status" />

          {/* Finance processing */}
          {(isSubmitted || hasVoucher || isDraft) && (
            <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Finance Processing</h2>
                  <p className="text-[11px] text-neutral-500">Voucher and payment lifecycle</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <FinanceMetric label="Current Stage" value={financeStage.currentStage} />
                <FinanceMetric label="Next Action" value={financeStage.nextAction} />
                <FinanceMetric label="Responsible Team" value={financeStage.responsibleTeam} />
                <FinanceMetric
                  label="Expected Completion"
                  value={financeStage.expectedCompletion}
                />
              </div>

              {hasVoucher && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Voucher ID
                    </p>
                    <p className="truncate text-sm font-semibold text-neutral-900">{voucher!.id}</p>
                  </div>
                  <Link
                    to={`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
                  >
                    View Voucher
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}

              {!hasVoucher && canCreateVoucher && !isReadOnly && isSubmitted && (
                <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                  {voucherReady ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                      Digital Signature verified. You may create the supplier voucher
                      {!signedPdfReady
                        ? " (Signed PDF preview is optional and not yet available)."
                        : "."}
                    </div>
                  ) : isDevDemoMode ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                      <p className="font-semibold">
                        Warehouse Digital Signature is pending.
                      </p>
                      <p className="mt-1 text-amber-900">
                        Create Voucher stays enabled in Development/Demo mode. You will be
                        asked to confirm before continuing.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                      <p className="font-semibold">
                        Voucher creation is blocked until Warehouse Digital Signature is
                        completed.
                      </p>
                      <p className="mt-1 text-amber-900">{voucherBlockedReason}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-neutral-500">
                      Issue a supplier voucher to continue toward invoice and payment.
                    </p>
                    {(() => {
                      const productionLocked = !isDevDemoMode && !voucherReady;
                      const buttonEnabled =
                        !creatingVoucher && (isDevDemoMode || voucherReady);
                      return (
                        <button
                          type="button"
                          onClick={requestCreateVoucher}
                          disabled={!buttonEnabled}
                          title={
                            productionLocked ? voucherBlockedReason : undefined
                          }
                          aria-disabled={productionLocked}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm disabled:cursor-not-allowed ${
                            buttonEnabled
                              ? "bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                              : "border border-neutral-300 bg-neutral-100 text-neutral-500 disabled:opacity-100"
                          }`}
                        >
                          {creatingVoucher ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : productionLocked ? (
                            <Lock className="h-3.5 w-3.5" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                          {creatingVoucher ? "Creating…" : "Create Voucher"}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {signatureComplete && (
                <div className="mt-3">
                  <WarehouseVerificationCard grn={grn} compact />
                </div>
              )}

              {!hasVoucher && !canCreateVoucher && isSubmitted && (
                <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  Routed to the Finance queue — Accounts Payable will issue the supplier
                  voucher
                  {!signatureComplete
                    ? " after Warehouse completes Digital Signature."
                    : "."}
                </p>
              )}
            </section>
          )}

          {/* Activity timeline */}
          <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Activity Timeline
            </h2>
            <ol className="relative ml-2 border-l border-neutral-200 pl-4">
              {activityEvents.map((event, idx) => (
                <li key={event.id} className={`relative ${idx < activityEvents.length - 1 ? "pb-4" : ""}`}>
                  <span className="absolute -left-[21px] top-1 flex h-2.5 w-2.5 rounded-full bg-primary-500 ring-4 ring-white" />
                  <p className="text-sm font-medium text-neutral-900">{event.title}</p>
                  {event.detail && (
                    <p className="mt-0.5 text-xs text-neutral-600">{event.detail}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-neutral-400">{formatDateTime(event.timestamp)}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Draft states */}
          {!isReadOnly && isDraft && !canManageGRN && (
            <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 shadow-sm">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  Awaiting warehouse receipt confirmation
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  The Warehouse team confirms receipt and submits this GRN.
                </p>
              </div>
            </div>
          )}

          {!isReadOnly && isDraft && canManageGRN && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-3 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {signatureComplete
                    ? "Ready to confirm receipt?"
                    : "Warehouse Digital Signature required"}
                </p>
                <p className="text-xs text-amber-800">
                  {signatureComplete
                    ? "Submitting updates inventory and the linked PO received percentage."
                    : "Complete Warehouse Digital Signature before submit. Inventory updates after signature is recorded."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={
                  submitMutation.isPending || !signatureComplete
                }
                title={
                  !signatureComplete
                    ? "Warehouse Digital Signature is mandatory before submitting GRN."
                    : undefined
                }
                className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitMutation.isPending ? "Submitting…" : "Submit GRN"}
              </button>
            </div>
          )}

          {isReadOnly && (
            <p className="text-center text-xs text-neutral-400">
              Read-only view opened from the purchase order.
            </p>
          )}
        </div>

        {/* Quick actions sidebar */}
        <aside className="w-full lg:sticky lg:top-4 lg:w-[220px] lg:shrink-0 lg:self-start">
          <QuickActionsCard
            hasVoucher={hasVoucher}
            voucherId={voucher?.id}
            signedPdfReady={signedPdfReady}
            onViewSigned={scrollToSignedGrn}
            onDownload={handleDownload}
            onPrint={handlePrint}
          />
        </aside>
      </div>

      {signatureSummary && (
        <WarehouseSignatureVerifyModal
          open={verifyOpen}
          busy={verifyBusy}
          summary={signatureSummary}
          result={verifyResult}
          onClose={() => setVerifyOpen(false)}
        />
      )}

      {demoOverrideOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Close confirmation"
            onClick={() => setDemoOverrideOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-override-title"
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h2
                id="demo-override-title"
                className="text-base font-semibold text-slate-900"
              >
                Warehouse Digital Signature is pending
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                This action is allowed only in Development/Demo mode.
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800">Continue?</p>
            </div>
            <div className="flex justify-end gap-2 bg-slate-50/80 px-5 py-3">
              <button
                type="button"
                disabled={creatingVoucher}
                onClick={() => setDemoOverrideOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingVoucher}
                onClick={() => void handleCreateVoucher({ demoOverride: true })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {creatingVoucher ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Continue &amp; Create Voucher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── UI helpers (display-only derivation) ───────────────────────────────── */

function deriveGrnWorkflow({
  linkedPOName,
  isSubmitted,
  hasVoucher,
  voucher,
  signatureComplete,
}: {
  linkedPOName?: string;
  isSubmitted: boolean;
  hasVoucher: boolean;
  voucher: Voucher | null;
  signatureComplete: boolean;
}) {
  const poCreated = !!linkedPOName;
  // Receive Goods completes when the GRN document exists (draft or submitted).
  const goodsReceived = true;
  const signatureDone = signatureComplete;
  // Inventory / voucher stages only after permanent signature storage succeeds.
  const inventoryUpdated = isSubmitted && signatureDone;
  const voucherDone = hasVoucher && signatureDone;

  const invoiceDone =
    signatureDone &&
    !!voucher &&
    (!!voucher.invoice ||
      ["invoice_raised", "under_review", "invoice_approved", "payment_confirmed", "payment_received"].includes(
        voucher.status
      ));

  const paymentDone =
    signatureDone &&
    !!voucher &&
    (!!voucher.payment ||
      voucher.status === "payment_confirmed" ||
      voucher.status === "payment_received" ||
      voucher.invoice?.status === "paid");

  return {
    steps: [
      { label: "PO Created", done: poCreated, sublabel: linkedPOName },
      { label: "Goods Received", done: goodsReceived },
      {
        label: "Warehouse Digital Signature",
        done: signatureDone,
        sublabel: signatureDone ? "SHA-256 verified" : "Mandatory",
      },
      { label: "Inventory Updated", done: inventoryUpdated },
      {
        label: "Voucher Pending",
        done: voucherDone,
        sublabel: voucher?.id,
      },
      {
        label: "Invoice",
        done: invoiceDone,
        sublabel: voucher?.invoice?.invoice_number,
      },
      { label: "Payment", done: paymentDone },
    ],
  };
}

function deriveFinanceStage({
  isSubmitted,
  isDraft,
  hasVoucher,
  voucher,
  canCreateVoucher,
  isReadOnly,
  signatureComplete,
}: {
  isSubmitted: boolean;
  isDraft: boolean;
  hasVoucher: boolean;
  voucher: Voucher | null;
  canCreateVoucher: boolean;
  isReadOnly: boolean;
  signatureComplete: boolean;
}) {
  if (!signatureComplete) {
    return {
      currentStage: "Waiting for Warehouse Digital Signature",
      nextAction: "Warehouse must Complete & Sign so the Signed GRN PDF is stored",
      responsibleTeam: "Warehouse Operations",
      expectedCompletion: "Same business day",
    };
  }

  if (isDraft) {
    return {
      currentStage: "Goods Receipt (Draft)",
      nextAction: "Warehouse to confirm and submit GRN",
      responsibleTeam: "Warehouse Operations",
      expectedCompletion: "Same business day",
    };
  }

  if (!isSubmitted) {
    return {
      currentStage: "Pending Submission",
      nextAction: "Complete goods receipt confirmation",
      responsibleTeam: "Warehouse Operations",
      expectedCompletion: "1 business day",
    };
  }

  if (!hasVoucher) {
    return {
      currentStage: "Awaiting Voucher",
      nextAction: canCreateVoucher && !isReadOnly
        ? "Create supplier voucher"
        : "Finance to issue voucher",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "1–2 business days",
    };
  }

  if (voucher?.payment || voucher?.status === "payment_confirmed" || voucher?.status === "payment_received") {
    return {
      currentStage: "Payment Complete",
      nextAction: "No action required",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "Completed",
    };
  }

  if (voucher?.invoice?.status === "paid") {
    return {
      currentStage: "Invoice Paid",
      nextAction: "Awaiting supplier payment confirmation",
      responsibleTeam: "Supplier Portal",
      expectedCompletion: "2–3 business days",
    };
  }

  if (voucher?.invoice || ["invoice_raised", "under_review"].includes(voucher?.status ?? "")) {
    return {
      currentStage: "Invoice Under Review",
      nextAction: "Finance to approve supplier invoice",
      responsibleTeam: "Finance & Procurement",
      expectedCompletion: voucher?.invoice?.due_date
        ? formatDate(voucher.invoice.due_date)
        : "3–5 business days",
    };
  }

  if (voucher?.status === "invoice_approved") {
    return {
      currentStage: "Invoice Approved",
      nextAction: "Release payment to supplier",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "1–2 business days",
    };
  }

  return {
    currentStage: "Voucher Issued",
    nextAction: "Supplier to raise invoice against voucher",
    responsibleTeam: "Supplier",
    expectedCompletion: voucher?.due_date ? formatDate(voucher.due_date) : "5–7 business days",
  };
}

function buildActivityEvents(
  grn: { name: string; creation?: string; modified?: string; supplier_name?: string; supplier: string },
  voucher: Voucher | null,
  isSubmitted: boolean
) {
  const events: Array<{ id: string; title: string; detail?: string; timestamp: string }> = [];

  if (grn.creation) {
    events.push({
      id: "created",
      title: "GRN created",
      detail: `Draft goods receipt ${grn.name} opened`,
      timestamp: grn.creation,
    });
  }

  if (isSubmitted && grn.modified) {
    events.push({
      id: "submitted",
      title: "Goods receipt submitted",
      detail: "Inventory receipt confirmed and PO updated",
      timestamp: grn.modified,
    });
  }

  if (voucher?.created_at) {
    events.push({
      id: "voucher",
      title: "Voucher issued",
      detail: `Finance voucher ${voucher.id} created`,
      timestamp: voucher.created_at,
    });
  }

  if (voucher?.invoice?.raised_at) {
    events.push({
      id: "invoice",
      title: "Supplier invoice received",
      detail: voucher.invoice.invoice_number,
      timestamp: voucher.invoice.raised_at,
    });
  }

  if (voucher?.payment?.confirmed_at) {
    events.push({
      id: "payment",
      title: "Payment confirmed",
      detail: voucher.payment.reference_number || undefined,
      timestamp: voucher.payment.confirmed_at,
    });
  }

  for (const entry of voucher?.history ?? []) {
    events.push({
      id: entry.id,
      title: entry.action,
      detail: entry.note || `${entry.actor} (${entry.actor_role})`,
      timestamp: entry.timestamp,
    });
  }

  if (events.length === 0 && grn.modified) {
    events.push({
      id: "modified",
      title: "Record updated",
      timestamp: grn.modified,
    });
  }

  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function BackLink({ backToPoPath }: { backToPoPath?: string | null }) {
  if (backToPoPath) {
    return (
      <Link
        to={backToPoPath}
        className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Order
      </Link>
    );
  }

  return (
    <Link
      to="/p2p/grn"
      className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" /> Back to GRNs
    </Link>
  );
}

function LargeStatusBadge({ status }: { status: string }) {
  const classes =
    LARGE_STATUS_STYLES[status] ?? "bg-primary-50 text-primary-800 ring-primary-200";
  return (
    <span
      className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-bold ring-2 ring-inset ${classes}`}
    >
      {status}
    </span>
  );
}

function SummaryField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right font-semibold ${
          highlight ? "text-primary-600" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function FinanceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function QuickActionsCard({
  hasVoucher,
  voucherId,
  signedPdfReady,
  onViewSigned,
  onDownload,
  onPrint,
}: {
  hasVoucher: boolean;
  voucherId?: string;
  signedPdfReady: boolean;
  onViewSigned: () => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  const pdfHint =
    "Available after the Signed GRN PDF is stored. Use Verify Signature in Digital Signature Information.";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
        Quick Actions
      </h2>
      <nav className="flex flex-col gap-1.5">
        {signedPdfReady ? (
          <>
            <QuickActionButton icon={Eye} label="View Signed GRN" onClick={onViewSigned} />
            <QuickActionButton icon={Download} label="Download Signed GRN" onClick={onDownload} />
            <QuickActionButton icon={Printer} label="Print Signed GRN" onClick={onPrint} />
          </>
        ) : (
          <>
            <QuickActionDisabled icon={Eye} label="View Signed GRN" hint={pdfHint} />
            <QuickActionDisabled icon={Download} label="Download Signed GRN" hint={pdfHint} />
            <QuickActionDisabled icon={Printer} label="Print Signed GRN" hint={pdfHint} />
          </>
        )}
        {hasVoucher && voucherId ? (
          <QuickActionLink
            to={`/p2p/vouchers/${encodeURIComponent(voucherId)}`}
            icon={Truck}
            label="Track Voucher"
          />
        ) : (
          <QuickActionDisabled
            icon={Truck}
            label="Track Voucher"
            hint="Voucher has not been created yet."
          />
        )}
      </nav>
    </div>
  );
}

function DocActionBtn({
  icon: Icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "Available when the optional Signed GRN PDF has been generated and stored."
          : undefined
      }
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${
        primary
          ? "bg-primary-600 text-white hover:bg-primary-700 disabled:hover:bg-primary-600"
          : "border border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function SigRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "bad" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-slate-900";
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-all font-semibold ${toneClass} ${
          mono ? "font-mono text-[10px]" : "text-xs"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function QuickActionLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary-600" />
      {label}
    </Link>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm font-medium text-neutral-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary-600" />
      {label}
    </button>
  );
}

function QuickActionDisabled({
  icon: Icon,
  label,
  hint = "Unavailable",
}: {
  icon: typeof FileText;
  label: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-400"
      title={hint}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
