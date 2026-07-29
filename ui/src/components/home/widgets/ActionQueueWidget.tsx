import { Inbox } from "lucide-react";
import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { buildActionGroups } from "../actionQueue";
import { ActionQueueGroup } from "./ActionQueueGroup"; // move the component here
import { WidgetShell } from "./WidgetShell";
import { WidgetEmpty, WidgetLoading } from "./WidgetStates";
import type { WidgetProps } from "./types";

export function ActionQueueWidget({ companyId, editing }: WidgetProps) {
  const { data, isLoading, isError } = useHomeSummary(companyId);
  const groups = data ? buildActionGroups(data) : [];
  return (
    <WidgetShell title="Action queue" icon={Inbox} to="/issues" editing={editing}>
      {isLoading ? (
        <WidgetLoading />
      ) : isError ? (
        <WidgetEmpty icon={Inbox} message="Couldn't load" />
      ) : groups.length === 0 ? (
        <WidgetEmpty icon={Inbox} message="Nothing needs review — all clear" />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => <ActionQueueGroup key={group.id} group={group} editing={editing} />)}
        </div>
      )}
    </WidgetShell>
  );
}
