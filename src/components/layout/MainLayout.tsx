import { Outlet } from "react-router-dom";

import { LayoutProvider, useLayout } from "../../contexts/LayoutContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import ProcurementChat from "../ChatBot/ProcurementChat";
import ConnectionStatus from "../ConnectionStatus";
import Header from "./Header";
import PageContainer from "./PageContainer";
import Sidebar from "./Sidebar";

function MainLayoutShell() {
  const { mobileNavOpen, closeMobileNav, sidebarMode, sidebarOffset } =
    useLayout();
  useDocumentTitle();

  const sidebarVariant =
    sidebarMode === "collapsed"
      ? "collapsed"
      : sidebarMode === "compact"
        ? "compact"
        : "full";

  return (
    <div className="app-shell min-w-0 bg-surface-page">
      {sidebarMode !== "drawer" && (
        <Sidebar variant={sidebarVariant} fixed />
      )}

      {sidebarMode === "drawer" && mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-neutral-900/40"
          onClick={closeMobileNav}
        />
      )}

      {sidebarMode === "drawer" && (
        <div
          className={`fixed inset-y-0 left-0 z-50 max-w-[100vw] transform transition-transform duration-300 ease-in-out ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            variant="full"
            onNavigate={closeMobileNav}
            fixed
            className="app-drawer-panel"
          />
        </div>
      )}

      <div
        className="app-shell-main transition-[margin,width] duration-300 ease-in-out"
        style={
          sidebarMode !== "drawer"
            ? {
                marginLeft: sidebarOffset,
                width: `calc(100% - ${sidebarOffset}px)`,
              }
            : { width: "100%" }
        }
      >
        <Header />
        <ConnectionStatus />
        <main className="app-shell-scroll layout-main">
          <PageContainer>
            <Outlet />
          </PageContainer>
        </main>
      </div>

      <ProcurementChat />
    </div>
  );
}

export default function MainLayout() {
  return (
    <LayoutProvider>
      <MainLayoutShell />
    </LayoutProvider>
  );
}
