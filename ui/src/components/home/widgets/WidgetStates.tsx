import type { ComponentType } from "react";

/** Centered empty state for a widget body (inside WidgetShell). Optional CTA. */
export function WidgetEmpty({ icon: Icon, message, ctaLabel, onCta }: {
  icon: ComponentType<{ className?: string }>;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-muted-foreground">
      <Icon className="h-6 w-6 opacity-70" aria-hidden />
      <p className="text-sm">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" onClick={onCta} className="rounded-md border border-border px-2.5 py-1 text-xs text-primary transition-colors hover:bg-accent/50">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

/** Minimal loading placeholder for a widget body — distinct from empty so a
 *  populated widget never flashes its empty state before its data resolves. */
export function WidgetLoading() {
  return <div className="flex h-full items-center justify-center"><span className="text-xs text-muted-foreground">Loading…</span></div>;
}
