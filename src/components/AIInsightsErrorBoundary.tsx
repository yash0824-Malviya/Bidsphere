import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Scoped error boundary for AI insight modules on the RFQ detail page.
 * Prevents a render failure in AI UI from crashing the entire page.
 */
export default class AIInsightsErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[AIInsightsErrorBoundary] caught:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Unable to load AI insights. Please try again.
              </p>
              <button
                type="button"
                onClick={this.handleRetry}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
              >
                <RefreshCw className="h-3 w-3" />
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
