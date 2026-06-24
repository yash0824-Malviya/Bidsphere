import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertOctagon, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without this, a single thrown component renders
 * an empty `<div id="root"></div>` and looks like a blank white screen.
 *
 * This catches render and lifecycle errors, logs them, and shows a fallback
 * UI with a message + a reload button so the issue is always visible.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    try {
      localStorage.removeItem("inteva-auth");
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.assign("/login");
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-danger-50 via-neutral-50 to-warning-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-danger-200 bg-white p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-neutral-900">
                Something went wrong
              </h1>
              <p className="mt-1 text-sm text-neutral-600">
                The app hit an unexpected error while rendering. The most
                common cause is a stale local session — clearing it and signing
                in again usually fixes it.
              </p>
              <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-neutral-50 p-3 text-xs text-neutral-700 ring-1 ring-inset ring-neutral-200">
                {this.state.error.name}: {this.state.error.message}
              </pre>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Clear session &amp; sign in
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
