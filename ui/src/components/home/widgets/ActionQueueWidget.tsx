import { Inbox } from "lucide-react";
import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { buildActionGroups } from "../actionQueue";
import { ActionQueueGroup } from "./ActionQueueGroup"; // move the component here
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

export function ActionQueueWidget({ companyId, editing }: WidgetProps) {
  const { data } = useHomeSummary(companyId);
  const groups = data ? buildActionGroups(data) : [];
  if (groups.length === 0) return null; // matches today: block hidden when empty
  return (
    <WidgetShell title="Action queue" icon={Inbox} to="/issues" editing={editing}>
      <div className="space-y-3">
        {groups.map((group) => <ActionQueueGroup key={group.id} group={group} />)}
      </div>
    </WidgetShell>
  );
}
