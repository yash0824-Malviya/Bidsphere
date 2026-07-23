import { Outlet } from "react-router-dom";

import { LayoutProvider, useLayout } from "../../contexts/LayoutContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import ProcurementChat from "../ChatBot/ProcurementChat";
import ConnectionStatus from "../ConnectionStatus";
import Header from "./Header";
import PageContainer from "./PageContainer";
import Sidebar from "./Sidebar";

function sidebarOffsetPx(mode: "drawer" | "collapsed" | "full"): number {
  if (mode === "drawer") return 0;
  if (mode === "collapsed") return 64;
  return 240;
}

function MainLayoutShell() {
  const { mobileNavOpen, closeMobileNav, sidebarMode } = useLayout();
  useDocumentTitle();

  const sidebarVariant =
    sidebarMode === "drawer"
      ? "full"
      : sidebarMode === "collapsed"
        ? "collapsed"
        : "full";

  const offset = sidebarOffsetPx(sidebarMode);

  return (
    <div className="min-h-screen w-full bg-surface-page">
      {sidebarMode !== "drawer" && (
        <Sidebar variant={sidebarVariant} fixed />
      )}

      {sidebarMode === "drawer" && mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-neutral-900/40 md:hidden"
          onClick={closeMobileNav}
        />
      )}

      {sidebarMode === "drawer" && (
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar variant="full" onNavigate={closeMobileNav} fixed />
        </div>
      )}

      <div
        className="flex min-h-screen min-w-0 flex-col transition-[margin,width] duration-300 ease-in-out"
        style={
          sidebarMode !== "drawer"
            ? {
                marginLeft: offset,
                width: `calc(100% - ${offset}px)`,
              }
            : undefined
        }
      >
        <Header />
        <ConnectionStatus />
        <main className="layout-main">
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
