import { Building2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

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
 *
 * Uses the design-system §9.8 empty-state pattern (brand-tinted hero icon,
 * radial brand wash bg) inline because we have two CTAs (create + import)
 * — the EmptyState primitive only takes one action.
 */
export function LobbyEmptyState({ onCreate, onImport }: LobbyEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16 bg-[radial-gradient(ellipse_60%_50%_at_50%_30%,var(--brand-wash)_0%,transparent_70%)]">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <div
          className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-brand-wash border border-brand/20 text-brand"
          aria-hidden="true"
        >
          <Building2 className="h-6 w-6 sm:h-7 sm:w-7" />
        </div>
        <h1 className="mt-5 sm:mt-6 text-xl sm:text-2xl font-bold tracking-[-0.02em] text-foreground">
          Welcome to AoA<span className="text-brand">.</span>
        </h1>
        <p className="mt-2 max-w-md text-[0.82rem] sm:text-sm text-dim leading-relaxed">
          Companies are the workspace for your hybrid team — agents, humans, goals,
          and tasks. Create your first one to get started, or import an existing
          bundle.
        </p>

        <div className="mt-6 sm:mt-8 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          <Button size="lg" onClick={onCreate}>
            <Plus />
            Create company
          </Button>
          <Button size="lg" variant="secondary" onClick={onImport}>
            <Upload />
            Import company
          </Button>
        </div>
      </div>
    </div>
  );
}
