import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

type SidebarMode = "drawer" | "collapsed" | "full";

interface LayoutContextValue {
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
  sidebarMode: SidebarMode;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (open: boolean) => void;
  toggleMobileSearch: () => void;
  /** True while a page renders its own <PageHeader>, so the global header
   * suppresses its duplicate title. */
  hasPageHeader: boolean;
  registerPageHeader: () => void;
  unregisterPageHeader: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

function resolveSidebarMode(width: number): SidebarMode {
  if (width < 768) return "drawer";
  if (width < 1024) return "collapsed";
  return "full";
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [pageHeaderCount, setPageHeaderCount] = useState(0);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    typeof window !== "undefined"
      ? resolveSidebarMode(window.innerWidth)
      : "full"
  );

  useEffect(() => {
    function onResize() {
      setSidebarMode(resolveSidebarMode(window.innerWidth));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setMobileSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (sidebarMode !== "drawer") {
      setMobileNavOpen(false);
    }
  }, [sidebarMode]);

  useEffect(() => {
    if (sidebarMode !== "drawer" || !mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, sidebarMode]);

  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const toggleMobileNav = useCallback(
    () => setMobileNavOpen((v) => !v),
    []
  );
  const toggleMobileSearch = useCallback(
    () => setMobileSearchOpen((v) => !v),
    []
  );

  const registerPageHeader = useCallback(
    () => setPageHeaderCount((c) => c + 1),
    []
  );
  const unregisterPageHeader = useCallback(
    () => setPageHeaderCount((c) => Math.max(0, c - 1)),
    []
  );

  const value = useMemo(
    () => ({
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      toggleMobileNav,
      sidebarMode,
      mobileSearchOpen,
      setMobileSearchOpen,
      toggleMobileSearch,
      hasPageHeader: pageHeaderCount > 0,
      registerPageHeader,
      unregisterPageHeader,
    }),
    [
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      toggleMobileNav,
      sidebarMode,
      mobileSearchOpen,
      toggleMobileSearch,
      pageHeaderCount,
      registerPageHeader,
      unregisterPageHeader,
    ]
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error("useLayout must be used within LayoutProvider");
  }
  return ctx;
}

/** Layout context accessor that tolerates being outside a LayoutProvider
 * (e.g. the supplier portal), returning null instead of throwing. */
export function useOptionalLayout(): LayoutContextValue | null {
  return useContext(LayoutContext);
}
