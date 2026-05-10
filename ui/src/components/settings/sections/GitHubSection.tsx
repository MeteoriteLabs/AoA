import { GitHubIntegrationCard } from "@/components/GitHubIntegrationCard";

/**
 * Settings → Operations → GitHub.
 *
 * Wraps the existing {@link GitHubIntegrationCard} with the standard
 * settings section chrome (eyebrow + h2 + description + bottom border).
 * The amber "→ migrating to plugins" pill marks the section as
 * transitional — its functionality will move into the GitHub plugin
 * once the plugin marketplace is stable.
 */
export function GitHubSection() {
  return (
    <div>
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
              Settings · Operations
            </div>
            <h2 className="text-[1.4rem] font-bold tracking-tight mt-1">
              GitHub<span className="text-brand">.</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              GitHub Personal Access Token used for workspace pull-request creation.
            </p>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-amber-500/15 text-amber-400/80 border border-amber-500/30 whitespace-nowrap shrink-0">
            → migrating to plugins
          </span>
        </div>
      </div>
      <div className="p-8 max-w-[680px]">
        <GitHubIntegrationCard />
      </div>
    </div>
  );
}
