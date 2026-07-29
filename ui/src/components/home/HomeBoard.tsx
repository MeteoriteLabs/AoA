import type { UserRole } from "@armyofagents/shared";
import { getWidget } from "./widgets/registry";
import { getDefaultLayout } from "./defaultLayout";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";

export function HomeBoard({ companyId, role }: { companyId: string; role: UserRole | null }) {
  return (
    <div className="space-y-6">
      {getDefaultLayout(role).map((key) => {
        const def = getWidget(key);
        if (!def) return null; // unknown key — skip defensively (design §11)
        const Widget = def.Component;
        return (
          // Key includes companyId so a switch remounts the boundary — a widget
          // that errored for one company recovers when you change companies.
          <WidgetErrorBoundary key={`${key}-${companyId}`}>
            {/* size is a placeholder until Task B3 wires the real react-grid-layout grid (canonical lg + derived breakpoints). */}
            <Widget companyId={companyId} role={role} size={{ w: 2, h: 2 }} />
          </WidgetErrorBoundary>
        );
      })}
    </div>
  );
}
