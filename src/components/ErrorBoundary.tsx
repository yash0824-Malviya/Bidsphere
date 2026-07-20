import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { APP_NAME } from "../config/branding";
import {
  createErrorId,
  reportClientError,
} from "../utils/clientErrorReporting";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorId: string | null;
}

/**
 * Top-level error boundary. Catches render/lifecycle errors and shows a
 * recovery UI. Never surfaces stack traces or backend details to end users.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, errorId: createErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const errorId = this.state.errorId || createErrorId();
    if (!this.state.errorId) {
      this.setState({ errorId });
    }
    // Always surface the real error in the browser console for developers.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", errorId, error, info.componentStack);
    reportClientError(error, {
      errorId,
      componentStack: info.componentStack,
      source: "ErrorBoundary",
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoDashboard = () => {
    window.location.assign("/dashboard");
  };

  render() {
    if (!this.state.error) return this.props.children;

    const errorId = this.state.errorId || "ERR-UNKNOWN";

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-white p-4">
        <div className="enterprise-fade-in w-full max-w-lg rounded-2xl border border-neutral-100 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#146CE8]/15 bg-white shadow-sm">
              <BrandLogo size="xs" className="max-h-8 max-w-[2rem]" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#146CE8]">
              {APP_NAME}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
                Unable to load this document
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
                The requested information is temporarily unavailable. Please
                try again or return to your dashboard.
              </p>
              <p className="mt-3 text-xs text-neutral-400">
                Reference{" "}
                <span className="font-mono font-semibold text-neutral-600">
                  {errorId}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={this.handleGoDashboard}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              <Home className="h-3.5 w-3.5" />
              Back
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#146CE8] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0F5BC7]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
