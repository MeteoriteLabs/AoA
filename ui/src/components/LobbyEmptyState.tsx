import { Building2, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface LobbyEmptyStateProps {
  onCreate: () => void;
  onImport: () => void;
}

/**
 * Designed empty hero shown when the lobby has zero companies.
 *
 * Replaces the previous behavior where a 0-company lobby auto-opened the
 * onboarding modal on mount. The empty state surfaces both create and import
 * paths and lets the founder choose intentionally instead of being thrown
 * straight into a modal.
 */
export function LobbyEmptyState({ onCreate, onImport }: LobbyEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card/85",
            "shadow-sm",
          )}
          aria-hidden="true"
        >
          <Building2 className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
          Welcome to AoA
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Companies are the workspace for your hybrid team — agents, humans, goals,
          and tasks. Create your first one to get started, or import an existing
          bundle.
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onCreate}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2",
              "text-sm font-medium text-primary-foreground transition-colors",
              "hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <Plus className="h-4 w-4" />
            Create company
          </button>
          <button
            type="button"
            onClick={onImport}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2",
              "text-sm font-medium text-foreground transition-colors",
              "hover:bg-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <Upload className="h-4 w-4" />
            Import company
          </button>
        </div>
      </div>
    </div>
  );
}
