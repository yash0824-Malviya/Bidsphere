import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, Building2, ChevronDown, CircleHelp, LifeBuoy, LogOut, Mail, Settings, ShieldCheck, User } from "lucide-react";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";

interface Props {
  supplierName: string;
  statusBadge?: string;
  unreadCount: number;
  onLogout: () => void;
}

/** Entry points only: session, notification data and logout remain owned by the layout. */
export default function SupplierPortalHeaderActions({ supplierName, statusBadge, unreadCount, onLogout }: Props) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<"profile" | "support" | null>(null);
  const profileLinkRef = useRef<HTMLAnchorElement>(null);
  const supportLinkRef = useRef<HTMLAnchorElement>(null);
  const close = () => setOpenMenu(null);
  const logout = () => { close(); onLogout(); };
  const statusTone = (statusBadge || "").toLowerCase().includes("approved")
    ? "approved" : (statusBadge || "").toLowerCase().includes("reject") ? "rejected" : "pending";

  return (
    <div className="supplier-header-actions">
      <div className="supplier-header-language"><LanguageSwitcher /></div>
      <Link
        to="/supplier/dashboard"
        className="supplier-header-control supplier-header-notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={close}
      >
        <Bell aria-hidden="true" />
        {unreadCount > 0 && <span className="supplier-header-unread">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </Link>

      <Popover open={openMenu === "support"} onOpenChange={(open) => setOpenMenu(open ? "support" : null)}>
        <PopoverTrigger asChild>
          <button type="button" className="supplier-header-control supplier-header-support" aria-label={t("supplierNav.support", "Support")}>
            <CircleHelp aria-hidden="true" /><span>{t("supplierNav.support", "Support")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={10} collisionPadding={12} className="supplier-header-popover" aria-label="Support" onOpenAutoFocus={(event) => { event.preventDefault(); supportLinkRef.current?.focus(); }}>
          <Link ref={supportLinkRef} to="/supplier/help-desk" onClick={close} className="supplier-header-menu-item"><CircleHelp aria-hidden="true" />{t("supplierNav.helpAndSupport", "Help & Support")}</Link>
          <Link to="/supplier/contact-support" onClick={close} className="supplier-header-menu-item"><Mail aria-hidden="true" />{t("supplierNav.contactSupport", "Contact Support")}</Link>
          <Link to="/supplier/help-desk" onClick={close} className="supplier-header-menu-item"><LifeBuoy aria-hidden="true" />{t("supplierNav.supportTickets", "Support Tickets")}</Link>
        </PopoverContent>
      </Popover>

      <Popover open={openMenu === "profile"} onOpenChange={(open) => setOpenMenu(open ? "profile" : null)}>
        <PopoverTrigger asChild>
          <button type="button" className="supplier-header-profile" aria-label={`Supplier Profile: ${supplierName}`} title={supplierName}>
            <span className="supplier-header-avatar"><User aria-hidden="true" /></span>
            <span className="supplier-header-profile-name">{supplierName}</span>
            <ChevronDown className="supplier-header-chevron" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={10} collisionPadding={12} className="supplier-header-popover supplier-header-account" aria-label="Supplier Profile" onOpenAutoFocus={(event) => { event.preventDefault(); profileLinkRef.current?.focus(); }}>
          <p className="supplier-header-account-name">{supplierName}</p>
          <Link ref={profileLinkRef} to="/supplier/profile" onClick={close} className="supplier-header-menu-item"><User aria-hidden="true" />{t("supplierNav.profile", "Profile")}</Link>
          <Link to="/supplier/security" onClick={close} className="supplier-header-menu-item"><Settings aria-hidden="true" />{t("supplierNav.accountSettings", "Account Settings")}</Link>
          <div className="supplier-header-menu-item supplier-header-account-status">
            <ShieldCheck aria-hidden="true" />
            <span>{t("supplierNav.accountStatus", "Account Status")}</span>
            <span className="supplier-header-status" data-tone={statusTone}>{statusBadge || "—"}</span>
          </div>
          <Link to="/supplier/profile" onClick={close} className="supplier-header-menu-item"><Building2 aria-hidden="true" />{t("supplierNav.companyInformation", "Company Information")}</Link>
          <div className="supplier-header-mobile-language">
            <span>{t("language.label", "Language")}</span><LanguageSwitcher />
          </div>
          <div className="supplier-header-menu-divider" />
          <button type="button" onClick={logout} className="supplier-header-menu-item"><LogOut aria-hidden="true" />{t("supplierNav.logout", "Logout")}</button>
        </PopoverContent>
      </Popover>

      <button type="button" onClick={logout} className="supplier-header-control supplier-header-logout" aria-label={t("supplierNav.logout", "Logout")}>
        <LogOut aria-hidden="true" /><span>{t("supplierNav.logout", "Logout")}</span>
      </button>
    </div>
  );
}
