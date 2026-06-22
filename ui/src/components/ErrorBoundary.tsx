import { Component, type ErrorInfo, type ReactNode } from "react";

// Vite injects `import.meta.env.DEV`; the UI tsconfig doesn't reference
// `vite/client`, so read it through a narrow cast instead of the ambient type.
const isDev = Boolean(
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
);

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * App-root error boundary. Catches render crashes anywhere in the tree so a
 * thrown error in Home/Tasks/Discussions/Commander shows a recoverable
 * fallback instead of a blank white screen.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Uncaught render error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          {isDev && (
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-field p-3 text-left text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex h-8 items-center justify-center rounded-md bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
