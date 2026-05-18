import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions and shows a fallback instead of unmounting
 * the whole tree (React 19 default). Reload restores the app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <div className="max-w-lg w-full border border-destructive/40 rounded-lg bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5" />
            <h2 className="font-semibold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. The full stack trace is in your
            browser DevTools console.
          </p>
          <pre className="text-xs bg-muted/50 border rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
