import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ComposerDensity = "comfortable" | "compact" | "mobile";

export interface ComposerFrameProps {
  density?: ComposerDensity;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
  "data-thread-id"?: string;
  "data-reply"?: string;
  "data-parent-entry-id"?: string;
}

/** Shared Quiet Operator frame: status/context, tray, editor, controls, error. */
export function ComposerFrame({ density = "comfortable", children, className, style, "data-testid": testId, "data-thread-id": threadId, "data-reply": reply, "data-parent-entry-id": parentEntryId }: ComposerFrameProps) {
  return (
    <div
      data-composer-frame
      data-density={density}
      data-testid={testId}
      data-thread-id={threadId}
      data-reply={reply}
      data-parent-entry-id={parentEntryId}
      style={style}
      className={cn(
        "composer-frame flex min-w-0 flex-col",
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
