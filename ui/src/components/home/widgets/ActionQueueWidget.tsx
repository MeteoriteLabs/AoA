import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { buildActionGroups } from "../actionQueue";
import { ActionQueueGroup } from "./ActionQueueGroup"; // move the component here
import type { WidgetProps } from "./types";

export function ActionQueueWidget({ companyId }: WidgetProps) {
  const { data } = useHomeSummary(companyId);
  const groups = data ? buildActionGroups(data) : [];
  if (groups.length === 0) return null; // matches today: block hidden when empty
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Action Queue</h2>
      {groups.map((group) => <ActionQueueGroup key={group.id} group={group} />)}
    </div>
  );
}
