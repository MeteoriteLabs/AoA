import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SectionDiff } from "./types.js";

interface MergeDiffPaneProps {
  sections: SectionDiff[];
  onChange: (decisions: Record<string, "mine" | "theirs">) => void;
}

export function MergeDiffPane({ sections, onChange }: MergeDiffPaneProps) {
  const [decisions, setDecisions] = useState<Record<string, "mine" | "theirs">>(() => {
    const init: Record<string, "mine" | "theirs"> = {};
    for (const s of sections) {
      init[s.header] = s.state === "added" ? "theirs" : "mine";
    }
    return init;
  });

  useEffect(() => {
    onChange(decisions);
    // Only run on mount — decisions is stable from useState initializer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(header: string, choice: "mine" | "theirs") {
    const next = { ...decisions, [header]: choice };
    setDecisions(next);
    onChange(next);
  }

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {sections.map((section) => {
        const decision = decisions[section.header] ?? "mine";
        const unchanged = section.state === "unchanged";

        return (
          <div key={section.header} className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between bg-muted px-3 py-1.5">
              <span className="text-sm font-medium">
                {section.header === "__preamble__" ? "(Introduction)" : section.header}
              </span>
              <Badge
                variant={
                  section.state === "added"
                    ? "default"
                    : section.state === "removed"
                      ? "destructive"
                      : section.state === "changed"
                        ? "secondary"
                        : "outline"
                }
                className="text-xs capitalize"
              >
                {section.state}
              </Badge>
            </div>

            {unchanged ? (
              <p className="text-xs text-muted-foreground px-3 py-2">No changes in this section.</p>
            ) : (
              <div className="grid grid-cols-2 divide-x">
                {/* Mine */}
                <div
                  className={cn(
                    "p-3 cursor-pointer transition-colors",
                    decision === "mine" ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-muted/50",
                  )}
                  onClick={() => pick(section.header, "mine")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Mine</span>
                    {decision === "mine" && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">
                        Selected
                      </span>
                    )}
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80 max-h-40 overflow-y-auto">
                    {section.mine || (
                      <em className="text-muted-foreground not-italic">(none)</em>
                    )}
                  </pre>
                  <Button
                    size="sm"
                    variant={decision === "mine" ? "default" : "outline"}
                    className="mt-2 w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(section.header, "mine");
                    }}
                  >
                    Keep mine
                  </Button>
                </div>

                {/* Theirs */}
                <div
                  className={cn(
                    "p-3 cursor-pointer transition-colors",
                    decision === "theirs" ? "bg-green-50 dark:bg-green-950" : "hover:bg-muted/50",
                  )}
                  onClick={() => pick(section.header, "theirs")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Upstream</span>
                    {decision === "theirs" && (
                      <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                        Selected
                      </span>
                    )}
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80 max-h-40 overflow-y-auto">
                    {section.theirs || (
                      <em className="text-muted-foreground not-italic">(none)</em>
                    )}
                  </pre>
                  <Button
                    size="sm"
                    variant={decision === "theirs" ? "default" : "outline"}
                    className="mt-2 w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(section.header, "theirs");
                    }}
                  >
                    Accept upstream
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
