import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { UserRole } from "@armyofagents/shared";
import { getWidget } from "./widgets/registry";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { useHomeBoardLayout } from "../../hooks/useHomeBoardLayout";
import { buildDefaultLg, reconcileLg, projectToBreakpoint } from "./gridLayout";

// Native v2 RGL API (see RGL_V2_API.md) — breakpoints/cols are fixed, not
// props, since Home's board only ever has 3 tiers (lg/md/sm) and doesn't
// need to be configurable per caller.
const BREAKPOINTS = { lg: 1024, md: 640, sm: 0 };
const COLS = { lg: 4, md: 2, sm: 1 };

/**
 * The Home widget board: a read-only react-grid-layout tile grid (Task B3).
 * Persists nothing yet and ignores drag/resize — edit mode is Task C1. The
 * canonical desktop (lg) layout is either the user's saved layout
 * (reconciled against the live registry) or the role default; md/sm are
 * always *derived* from lg, never persisted (Task D1).
 */
export function HomeBoard({ companyId, role }: { companyId: string; role: UserRole | null }) {
  const { layout: savedLayout } = useHomeBoardLayout(companyId);
  const { width, mounted, containerRef } = useContainerWidth();

  const lg = savedLayout ? reconcileLg(savedLayout, role) : buildDefaultLg(role);
  const layouts = {
    lg,
    md: projectToBreakpoint(lg, COLS.md),
    sm: projectToBreakpoint(lg, COLS.sm),
  };

  return (
    <div ref={containerRef}>
      {mounted && (
        <Responsive
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={104}
          margin={[12, 12]}
          compactor={verticalCompactor}
          // Read-only for this task — drag/resize land in Task C1 (edit mode).
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
        >
          {lg.map((item) => {
            const def = getWidget(item.i);
            if (!def) return null; // unknown key — skip defensively (design §11)
            const Widget = def.Component;
            return (
              <div key={item.i}>
                {/* Key includes companyId so a switch remounts the boundary — a
                    widget that errored for one company recovers when you change
                    companies. */}
                <WidgetErrorBoundary key={`${item.i}-${companyId}`}>
                  <Widget companyId={companyId} role={role} editing={false} size={{ w: item.w, h: item.h }} />
                </WidgetErrorBoundary>
              </div>
            );
          })}
        </Responsive>
      )}
    </div>
  );
}
