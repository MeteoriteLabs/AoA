import { type CSSProperties } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion";
import { MapDiagram } from "./mapDiagram";

export type MapDoorPersona = "in_flight" | "explorer";

export type MapProps = {
  /** Fired when the founder picks a live door. Greenfield is parked/inert —
   * it never calls this. */
  onPick: (persona: MapDoorPersona) => void;
};

/** Per-door accent hue — all three resolve under `.onboarding-dark`
 * (see motion/motion.css): brand red, exploration teal, parked amber. */
type DoorAccent = "brand" | "teal" | "amber";

const ACCENT_VAR: Record<DoorAccent, string> = {
  brand: "var(--brand)",
  teal: "var(--teal)",
  amber: "var(--amber)",
};

function Door({
  emoji,
  title,
  subtitle,
  accent,
  onClick,
  disabled,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  accent: DoorAccent;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const c = ACCENT_VAR[accent];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ "--door-accent": c } as CSSProperties}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--door-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled
          ? "cursor-not-allowed border-dashed border-border bg-card/60 opacity-60"
          : "border-border-strong bg-card hover:-translate-y-0.5 hover:border-[color:var(--door-accent)] hover:shadow-[0_10px_28px_-16px_var(--door-accent)]",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base leading-none"
        style={{
          backgroundColor: `color-mix(in srgb, ${c} ${disabled ? 10 : 18}%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} ${disabled ? 22 : 40}%, transparent)`,
        }}
      >
        {emoji}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2">
          <h4 className="m-0 text-[13.5px] font-medium text-text">{title}</h4>
          {!disabled && (
            <ArrowRight
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-very-dim transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--door-accent)]"
            />
          )}
        </span>
        <p className="m-0 text-[11.5px] text-dim">{subtitle}</p>
        {disabled && (
          <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-medium text-dim">
            <Clock aria-hidden className="h-2.5 w-2.5" />
            Coming soon
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * WS9 — the founder's Home first-run: the flow diagram (mockup S6) plus the
 * door band underneath it, the persona fork. In-flight and Explorer are the
 * two live doors (`onPick`); Greenfield is parked/"coming soon" — disabled,
 * never calls `onPick`.
 */
export function Map({ onPick }: MapProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-8">
      <Reveal>
        <div className="flex items-center justify-between">
          <p className="m-0 font-mono text-xs text-dim">
            Home &middot; <span className="text-text">first run</span>
          </p>
          <span className="text-xs text-dim">THE MAP</span>
        </div>
      </Reveal>

      <Reveal delay={0.09}>
        <MapDiagram />
      </Reveal>

      <Reveal delay={0.18}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Door
            emoji="🚚"
            title="In-flight"
            subtitle="Bring your work in"
            accent="brand"
            onClick={() => onPick("in_flight")}
          />
          <Door
            emoji="🧭"
            title="Explorer"
            subtitle="Look around"
            accent="teal"
            onClick={() => onPick("explorer")}
          />
          <Door
            emoji="🌱"
            title="Greenfield"
            subtitle="Just an idea · soon"
            accent="amber"
            disabled
          />
        </div>
      </Reveal>
    </div>
  );
}
