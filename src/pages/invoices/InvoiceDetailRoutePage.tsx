import { useParams } from "react-router-dom";

import { getVoucherById } from "../../api/vouchers";
import InvoiceDetailPage from "../p2p/InvoiceDetailPage";
import InvoiceWorkflowDetailPage from "./InvoiceWorkflowDetailPage";

/**
 * Routes invoice detail by ID type:
 * - Voucher workflow IDs (VCH-*) → finance voucher invoice review
 * - ERPNext Purchase Invoice names (ACC-PINV-*, etc.) → live PI detail
 */
export default function InvoiceDetailRoutePage() {
  const { id = "" } = useParams();
  const invoiceId = decodeURIComponent(id);
  const voucher = getVoucherById(invoiceId);

  if (voucher?.invoice) {
    return <InvoiceWorkflowDetailPage />;
  }

  return <InvoiceDetailPage />;
}
