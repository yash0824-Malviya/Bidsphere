import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  title?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Local error boundary so a failing subsection (e.g. Cost Breakdown)
 * cannot take down the whole Supplier RFQ Details page.
 */
export default class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[SectionErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-900"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {this.props.title || "This section failed to load"}
            </p>
            <p className="mt-1 text-rose-800">
              {this.state.error.message || "Unexpected render error."}
            </p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry section
            </button>
          </div>
        </div>
      </div>
    );
  }
}
