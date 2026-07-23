import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Gavel } from "lucide-react";

import {
  deriveAuctionStatus,
  getSupplierAuctions,
  sameSupplier,
} from "../../api/reverseBidding";
import AuctionStatusBadge from "../../components/reverse-bidding/AuctionStatusBadge";
import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import { useClientPagination } from "../../hooks/usePagination";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

export default function SupplierAuctionsListPage() {
  const { t } = useTranslation();
  const { supplierName, isReady, isAuthenticated } = useSupplierSession();
  const navigate = useNavigate();

  const query = useQuery({
    // Shared with LiveAuctionStartedNotifier for instant list refresh.
    queryKey: ["supplier-auctions", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierAuctions(supplierName),
    refetchInterval: 2_000,
    staleTime: 1_000,
    refetchOnWindowFocus: true,
  });

  const auctions = query.data ?? [];

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(auctions, {
    defaultPageSize: 10,
    resetKey: supplierName,
  });

  if (isReady && !isAuthenticated) {
    return (
      
        <SupplierAccessDenied
          title={t("reverseBidding.signInRequired")}
          description={t("reverseBidding.signInToViewInvitations")}
        />
      
    );
  }

  return (
    
      <div>
        <h1 className="text-lg font-bold text-neutral-900">{t("reverseBidding.liveAuctionsTitle")}</h1>
        <p className="text-sm text-neutral-500">
          {t("reverseBidding.listSubtitle")}
        </p>
      </div>

      {query.isLoading ? (
        <div className="table-shell">
          <TableSkeleton rows={4} columns={4} />
        </div>
      ) : auctions.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={t("reverseBidding.noInvitationsTitle")}
          description={t("reverseBidding.noInvitationsDesc")}
        />
      ) : (
        <>
        <div className="grid gap-6 sm:grid-cols-2">
          {pageRows.map((a) => {
            const status = deriveAuctionStatus(a);
            const mine = (a.invited_suppliers ?? []).find((s) =>
              sameSupplier(s.supplier, supplierName)
            );
            const open = () =>
              navigate(`/supplier/auctions/${encodeURIComponent(a.name)}`);
            return (
              <div
                key={a.name}
                className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-900">
                    {a.name}
                  </span>
                  <AuctionStatusBadge status={status} />
                </div>
                <p className="mt-1 text-xs text-neutral-500">{t("reverseBidding.rfqPrefix")} {a.rfq}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.buyer")}</dt>
                    <dd className="truncate font-medium text-neutral-800">
                      {a.company || a.procurement_manager || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.currentLowest")}</dt>
                    <dd className="font-medium tabular-nums text-emerald-600">
                      {a.lowest_bid
                        ? formatCurrencyIn(a.lowest_bid, a.currency)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.auctionStart")}</dt>
                    <dd className="text-xs text-neutral-600">
                      {a.start_date_time
                        ? formatDateTime(a.start_date_time)
                        : t("reverseBidding.notScheduled")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.auctionEnd")}</dt>
                    <dd className="text-xs text-neutral-600">
                      {a.end_date_time
                        ? formatDateTime(a.end_date_time)
                        : t("reverseBidding.notScheduled")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.yourBid")}</dt>
                    <dd className="font-medium tabular-nums text-neutral-800">
                      {mine?.current_bid
                        ? formatCurrencyIn(mine.current_bid, a.currency)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-400">{t("reverseBidding.invitation")}</dt>
                    <dd className="font-medium text-neutral-800">
                      {mine?.invitation_status ?? "—"}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={open}
                  className="btn-primary mt-4 w-full justify-center"
                >
                  <Gavel className="h-4 w-4" />
                  {t("reverseBidding.openAuction")}
                </button>
              </div>
            );
          })}
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          totalRecords={totalRecords}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          recordLabel="records"
        />
        </>
      )}
    
  );
}
