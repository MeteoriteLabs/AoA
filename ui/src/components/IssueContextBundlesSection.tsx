import { ExternalLink, FileBox } from "lucide-react";
import { Link } from "@/lib/router";
import type { IssueContextBundle } from "../api/issues";

interface IssueContextBundlesSectionProps {
  bundles: IssueContextBundle[] | undefined;
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bundleLabel(bundle: IssueContextBundle) {
  if (bundle.brief?.toLowerCase().includes("discussion scope")) {
    return "Scope handoff";
  }
  return bundle.brief ?? "Context handoff";
}

export function IssueContextBundlesSection({
  bundles,
}: IssueContextBundlesSectionProps) {
  const visibleBundles = (bundles ?? []).filter((bundle) => (bundle.items ?? []).length > 0);
  if (visibleBundles.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="issue-context-bundles-section">
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <FileBox className="h-3.5 w-3.5" />
        Scope handoff
      </h3>

      <div className="space-y-2">
        {visibleBundles.map((bundle) => (
          <div
            key={bundle.id}
            className="rounded-md border border-border bg-accent/10 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                {bundleLabel(bundle)}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {bundle.items.length} item{bundle.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="space-y-2">
              {bundle.items.map((item) => {
                const sourceDiscussionId = metadataString(item.metadata, "discussionId");
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">
                        {item.label ?? item.sourceId ?? item.id}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-1.5 py-0.5">
                          {item.itemType}
                        </span>
                        {item.metadata?.source === "discussion_scope" && (
                          <span>Discussion scope</span>
                        )}
                      </div>
                    </div>

                    {sourceDiscussionId && (
                      <Link
                        to={`/discussions/${sourceDiscussionId}`}
                        className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open source thread
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
