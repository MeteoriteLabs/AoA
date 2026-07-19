import { cn } from "@/lib/utils";
import { Reveal } from "./motion";
import { MapDiagram } from "./mapDiagram";

export type MapDoorPersona = "in_flight" | "explorer";

export type MapProps = {
  /** Fired when the founder picks a live door. Greenfield is parked/inert —
   * it never calls this. */
  onPick: (persona: MapDoorPersona) => void;
};

function Door({
  emoji,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border-strong bg-card p-3 text-left transition-all",
        disabled
          ? "cursor-not-allowed border-dashed opacity-50"
          : "hover:-translate-y-0.5 hover:border-brand",
      )}
    >
      <h4 className="m-0 text-[13.5px] font-medium text-text">
        {emoji} {title}
      </h4>
      <p className="m-0 mt-0.5 text-[11.5px] text-dim">{subtitle}</p>
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
            subtitle="Bring your work in →"
            onClick={() => onPick("in_flight")}
          />
          <Door
            emoji="🧭"
            title="Explorer"
            subtitle="Look around"
            onClick={() => onPick("explorer")}
          />
          <Door emoji="🌱" title="Greenfield" subtitle="Just an idea · soon" disabled />
        </div>
      </Reveal>
    </div>
  );
}
