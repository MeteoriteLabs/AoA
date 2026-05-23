import { useState } from "react";
import { STATUS_COLORS } from "./git-arc-draw";

/** Collapsible legend explaining the Map's glyphs and status colors. */
export function GitGraphLegend() {
  const [open, setOpen] = useState(true);

  const statusRows: Array<{ color: string; label: string }> = [
    { color: STATUS_COLORS.in_progress, label: "In progress" },
    { color: STATUS_COLORS.in_review, label: "In review" },
    { color: STATUS_COLORS.blocked, label: "Blocked" },
    { color: STATUS_COLORS.done, label: "Done / cancelled" },
  ];

  return (
    <div className="absolute top-3 left-3 z-10 select-none">
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1e1d1c]/90 border border-[#2e2c2a] text-[11px] text-[#7E8AA8] hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span> Legend
      </button>
      {open && (
        <div className="mt-1 p-2.5 rounded bg-[#141312]/95 border border-[#2e2c2a] text-[11px] text-[#ccc] space-y-2 w-44">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Task status</div>
            {statusRows.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: r.color }} />
                {r.label}
              </div>
            ))}
          </div>
          <div className="space-y-1 pt-1 border-t border-[#2e2c2a]">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Graph</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 h-[3px] bg-white rounded shrink-0" /> Trunk (main)</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 h-[2px] bg-[#4FB67E] rounded shrink-0" /> Branch arc</div>
            <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#6470DC] shrink-0" /> Merge commit</div>
            <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full border border-[#7E8AA8] shrink-0" /> Branch tip</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dashed border-[#7E8AA8] shrink-0" /> Open branch (more ahead)</div>
          </div>
          <div className="space-y-1 pt-1 border-t border-[#2e2c2a]">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Badges</div>
            <div className="flex items-center gap-2"><span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#4FB67E] text-[7px] text-white shrink-0">✓</span> CI passing</div>
            <div className="flex items-center gap-2"><span className="inline-flex items-center justify-center px-1 h-3.5 rounded bg-[#6470DC]/30 border border-[#6470DC] text-[7px] text-[#8490e8] shrink-0">PR</span> Pull request</div>
            <div className="flex items-center gap-2"><span className="text-[#ffa040] shrink-0">⚠</span> Conflicts</div>
          </div>
        </div>
      )}
    </div>
  );
}
