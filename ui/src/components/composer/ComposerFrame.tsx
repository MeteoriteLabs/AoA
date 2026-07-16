import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ComposerDensity = "comfortable" | "compact" | "mobile";
export type ComposerChrome = "bare" | "card";

export interface ComposerFrameProps {
  density?: ComposerDensity;
  /**
   * Visual treatment. "card" = the Quiet Operator bordered focus-glow card
   * (derived from Commander's proven chrome + shadow-sm). "bare" (default)
   * leaves styling to the host during migration.
   *
   * The card variant must NEVER gain an overflow property: mention popovers
   * render `absolute bottom-full` INSIDE the frame (CommanderInput,
   * EntryAutocompleteList) and would be clipped — a breakage Playwright's
   * toBeVisible cannot detect.
   */
  chrome?: ComposerChrome;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
  "data-thread-id"?: string;
  "data-reply"?: string;
  "data-parent-entry-id"?: string;
}

/** Shared Quiet Operator frame: status/context, tray, editor, controls, error. */
export function ComposerFrame({ density = "comfortable", chrome = "bare", children, className, style, "data-testid": testId, "data-thread-id": threadId, "data-reply": reply, "data-parent-entry-id": parentEntryId }: ComposerFrameProps) {
  return (
    <div
      data-composer-frame
      data-density={density}
      data-chrome={chrome}
      data-testid={testId}
      data-thread-id={threadId}
      data-reply={reply}
      data-parent-entry-id={parentEntryId}
      style={style}
      className={cn(
        "composer-frame flex min-w-0 flex-col",
        chrome === "card" &&
          "rounded-lg border border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-brand-focus-ring focus-within:border-brand transition-shadow",
        density === "comfortable" && "gap-0",
        density === "compact" && "text-[0.95em]",
        density === "mobile" && "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
