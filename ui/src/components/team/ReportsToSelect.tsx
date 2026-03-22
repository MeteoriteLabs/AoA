import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Unified org-tree node containing both agents and humans.
 * Defined locally until T4 lands the shared type.
 */
export interface UnifiedOrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  nodeType: "agent" | "user";

  adapterType?: string;
  trustScore?: number;
  icon?: string;

  email?: string;
  userRole?: "founder" | "team_lead" | "team_member";
  departmentName?: string;
  avatarUrl?: string;

  children: UnifiedOrgNode[];
}

/** Sentinel used internally because Radix Select forbids empty-string values. */
const NONE_VALUE = "__none__";

export interface ReportsToSelectProps {
  /** The full org tree (forest of UnifiedOrgNode roots). */
  orgTree: UnifiedOrgNode[];
  /** ID of the entity being edited (to exclude from options). */
  currentEntityId: string;
  /** Type of the entity being edited. */
  currentEntityType: "agent" | "user";
  /** Current value as "nodeType:id" string, or empty string for none/root. */
  value: string;
  /** Callback with the composite value ("agent:id", "user:id", or "" for root). */
  onChange: (value: string) => void;
  /** Restrict options to a single nodeType (e.g. 'user' for humans tab per D1). */
  filterToType?: "agent" | "user";
  disabled?: boolean;
  className?: string;
}

/** Recursively flatten a UnifiedOrgNode tree into a flat list. */
export function flattenOrgTree(nodes: UnifiedOrgNode[]): UnifiedOrgNode[] {
  const result: UnifiedOrgNode[] = [];
  function walk(list: UnifiedOrgNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

function detailText(node: UnifiedOrgNode): string {
  if (node.nodeType === "agent") {
    return node.adapterType ?? node.role;
  }
  if (node.userRole) {
    const labels: Record<string, string> = {
      founder: "Founder",
      team_lead: "Team Lead",
      team_member: "Team Member",
    };
    return labels[node.userRole] ?? node.userRole;
  }
  return node.role;
}

export function ReportsToSelect({
  orgTree,
  currentEntityId,
  currentEntityType,
  value,
  onChange,
  filterToType,
  disabled,
  className,
}: ReportsToSelectProps) {
  const { agents, teamMembers } = useMemo(() => {
    const flat = flattenOrgTree(orgTree);

    // Exclude self
    const filtered = flat.filter(
      (node) =>
        !(node.id === currentEntityId && node.nodeType === currentEntityType),
    );

    // Apply filterToType restriction
    const applicable = filterToType
      ? filtered.filter((node) => node.nodeType === filterToType)
      : filtered;

    return {
      agents: applicable.filter((n) => n.nodeType === "agent"),
      teamMembers: applicable.filter((n) => n.nodeType === "user"),
    };
  }, [orgTree, currentEntityId, currentEntityType, filterToType]);

  const hasAgents = agents.length > 0;
  const hasTeamMembers = teamMembers.length > 0;

  const selectValue = value || NONE_VALUE;

  function handleChange(next: string) {
    onChange(next === NONE_VALUE ? "" : next);
  }

  return (
    <Select value={selectValue} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="None (root)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None (root)</SelectItem>

        {hasAgents && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Agents</SelectLabel>
              {agents.map((node) => (
                <SelectItem key={`agent:${node.id}`} value={`agent:${node.id}`}>
                  <span className="flex flex-col">
                    <span>{node.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {detailText(node)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}

        {hasTeamMembers && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Team Members</SelectLabel>
              {teamMembers.map((node) => (
                <SelectItem key={`user:${node.id}`} value={`user:${node.id}`}>
                  <span className="flex flex-col">
                    <span>{node.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {detailText(node)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
