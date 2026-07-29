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
            <Widget companyId={companyId} role={role} />
          </WidgetErrorBoundary>
        );
      })}
    </div>
  );
}
