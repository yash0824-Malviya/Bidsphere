const SUPPLIER_NAV_ALIASES: Record<string, readonly string[]> = {
  "/supplier/rfqs": ["/supplier/rfq"],
  "/supplier/quotations": ["/supplier/quotation"],
  "/supplier/purchase-orders": ["/supplier/po", "/supplier/orders"],
  "/supplier/auctions": ["/supplier/live-auctions"],
  "/supplier/vouchers": ["/supplier/finance"],
};

/** Keep canonical supplier navigation active on its detail and alias routes. */
export function isSupplierNavPathActive(pathname: string, to: string): boolean {
  const pathOnly = to.split("?")[0];
  const paths = [pathOnly, ...(SUPPLIER_NAV_ALIASES[pathOnly] ?? [])];
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
