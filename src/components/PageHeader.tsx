import { useLayoutEffect, type ReactNode } from "react";

import { useOptionalLayout } from "../contexts/LayoutContext";

interface Props {
  /**
   * Page titles have been removed from the global layout — the top of every
   * page shows ONLY the breadcrumb (rendered by the global Header). `title`,
   * `welcome`, and `description` are still accepted so existing call sites keep
   * compiling, but they are intentionally never rendered. Only `actions` (the
   * page-level toolbar) is displayed.
   */
  title?: string;
  welcome?: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({ actions }: Props) {
  const layout = useOptionalLayout();
  const register = layout?.registerPageHeader;
  const unregister = layout?.unregisterPageHeader;

  // Kept for backwards compatibility with the global header's layout state.
  useLayoutEffect(() => {
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [register, unregister]);

  // No title/description is rendered anymore — content begins immediately after
  // the breadcrumb. When a page provides toolbar actions, render them alone.
  if (!actions) return null;

  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      {actions}
    </div>
  );
}
