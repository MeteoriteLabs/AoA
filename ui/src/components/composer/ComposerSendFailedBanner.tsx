/** Approved mock §5: failure never eats your work — the draft/files/tokens
 *  stay in the card; the banner offers Retry / Edit / Discard. Renders INSIDE
 *  the ComposerFrame, above the tray. Host owns the failure state. */
import { AlertTriangle } from "lucide-react";

export interface ComposerSendFailedBannerProps {
  onRetry: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  retrying?: boolean;
}

export function ComposerSendFailedBanner({
  onRetry,
  onEdit,
  onDiscard,
  retrying = false,
}: ComposerSendFailedBannerProps) {
  return (
    <div
      role="alert"
      data-testid="composer-send-failed-banner"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">Failed to send. Your message is saved.</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-md bg-brand px-2.5 py-1 font-semibold text-white disabled:opacity-40"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-muted/60"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:bg-muted/60"
        >
          Discard
        </button>
      </span>
    </div>
  );
}
